import { type ChildProcess, spawn } from "node:child_process";
import { chmod, lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { AuthStorage } from "@f5-sales-demo/pi-ai";
import { getAgentDbPath, getAgentDir, VERSION } from "@f5-sales-demo/pi-utils";
import { loadRemoteSubscription, recoverRemoteSubscription } from "./auth";
import { remoteSocketPath } from "./bridge";
import { type ClientListOptions, listRemoteClients, revokeRemoteClient } from "./clients";
import { type Enrollment, enrollRemoteHost, refreshRemoteHost } from "./enrollment";
import { startLocalHost } from "./host";
import { connectPeer, listenLocal } from "./ipc";
import {
	inspectProcess,
	type LifecycleSnapshot,
	LifecycleStore,
	matchesProcessIdentity,
	signalVerifiedProcess,
	withLifecycleLock,
} from "./lifecycle-state";
import { startPairing } from "./pairing";
import { SystemdUserManager } from "./startup-manager";
import { RemoteSupervisor } from "./supervisor";

interface HostState {
	enabled: boolean;
	name: string;
	installationId: string;
	enrollment: Enrollment;
}
const root = () => join(getAgentDir(), "remote-control");
const statePath = () => join(root(), "host.json");
const supervisorSocketPath = () => join(root(), "supervisor.sock");
const lifecycleStore = () => new LifecycleStore(root());
const sourceArguments = () => (process.execPath.endsWith("bun") ? [process.argv[1]!] : []);
const startupManager = () =>
	new SystemdUserManager(
		process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
		process.execPath,
		sourceArguments(),
	);
async function refreshState(state: HostState): Promise<Enrollment> {
	const storage = await AuthStorage.create(getAgentDbPath());
	try {
		await storage.reload();
		const enrollment = await refreshRemoteHost(
			{
				name: state.name,
				installationId: state.installationId,
				version: VERSION,
				os: process.platform,
				arch: process.arch === "x64" ? "x86_64" : "aarch64",
			},
			await loadRemoteSubscription(storage, `xcsh-remote-${state.installationId}`),
			state.enrollment,
		);
		Object.assign(state.enrollment, enrollment);
		// Preserve a concurrent disable decision while updating the token.
		const current = await readState();
		await writeState({ ...state, enabled: current?.enabled ?? state.enabled });
		return enrollment;
	} finally {
		storage.close();
	}
}
async function readState(): Promise<HostState | undefined> {
	const file = Bun.file(statePath());
	return (await file.exists()) ? ((await file.json()) as HostState) : undefined;
}
async function writeState(state: HostState): Promise<void> {
	await mkdir(root(), { recursive: true, mode: 0o700 });
	await chmod(root(), 0o700);
	const temp = `${statePath()}.${crypto.randomUUID()}`;
	const file = await open(temp, "wx", 0o600);
	try {
		await file.writeFile(JSON.stringify(state));
	} finally {
		await file.close();
	}
	await rename(temp, statePath());
}

function stoppedLifecycle(enabled: boolean): LifecycleSnapshot {
	return {
		generation: 0,
		restartCount: 0,
		supervisorState: "stopped",
		hostState: "stopped",
		startupManager: enabled ? (process.platform === "linux" ? "systemd-user" : "process") : "none",
		degradedReason: null,
	};
}

async function probeHost(timeoutMs = 1_000): Promise<boolean> {
	let peer: Awaited<ReturnType<typeof connectPeer>> | undefined;
	try {
		peer = await connectPeer(remoteSocketPath());
		await Promise.race([
			peer.call("status", {}),
			new Promise((_, reject) => setTimeout(() => reject(new Error("Remote host probe timed out")), timeoutMs)),
		]);
		return true;
	} catch {
		return false;
	} finally {
		peer?.close();
	}
}

async function waitForProcessExit(pid: number, generation: number, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	do {
		if (!(await inspectProcess(pid, generation))) return true;
		await Bun.sleep(50);
	} while (Date.now() < deadline);
	return !(await inspectProcess(pid, generation));
}

async function stopManagedHost(
	record: NonNullable<Awaited<ReturnType<LifecycleStore["readRuntime"]>>>,
	drainMs: number,
): Promise<void> {
	let peer: Awaited<ReturnType<typeof connectPeer>> | undefined;
	try {
		peer = await connectPeer(remoteSocketPath());
		await peer.call("drain", { timeoutMs: drainMs }, drainMs + 5_000);
	} catch {
		// A crashed or wedged host falls through to exact-identity signalling.
	} finally {
		peer?.close();
	}
	if (await waitForProcessExit(record.pid, record.generation, 5_000)) return;
	if (!(await signalVerifiedProcess(record, "SIGTERM"))) return;
	if (await waitForProcessExit(record.pid, record.generation, 5_000)) return;
	if (!(await signalVerifiedProcess(record, "SIGKILL"))) return;
	if (!(await waitForProcessExit(record.pid, record.generation, 5_000)))
		throw new Error("The identity-verified xcsh remote host did not stop");
}

async function spawnManagedHost(generation: number): Promise<NonNullable<Awaited<ReturnType<typeof inspectProcess>>>> {
	await mkdir(root(), { recursive: true, mode: 0o700 });
	const log = await open(join(root(), "host.log"), "a", 0o600);
	let child: ChildProcess;
	try {
		await log.chmod(0o600);
		child = spawn(process.execPath, [...sourceArguments(), "remote-control", "host"], {
			stdio: ["ignore", log.fd, log.fd],
			env: { ...process.env, XCSH_REMOTE_GENERATION: String(generation) },
		});
	} finally {
		await log.close();
	}
	if (!child.pid) throw new Error("Unable to start the xcsh remote host");
	for (let attempt = 0; attempt < 100; attempt++) {
		const record = await inspectProcess(child.pid, generation);
		if (record) return record;
		if (child.exitCode !== null) break;
		await Bun.sleep(10);
	}
	throw new Error("Unable to identify the xcsh remote host process");
}

async function stopLegacyHost(): Promise<void> {
	let peer: Awaited<ReturnType<typeof connectPeer>> | undefined;
	try {
		peer = await connectPeer(remoteSocketPath());
		await peer.call("drain", { timeoutMs: 60_000 }, 65_000);
	} catch {
		// A legacy host has no trusted PID record. It may be asked to stop over its
		// owner-only socket, but it must never be force-signalled by guessed PID.
	} finally {
		peer?.close();
	}
}

async function requestSupervisorShutdown(timeoutMs = 85_000): Promise<boolean> {
	let peer: Awaited<ReturnType<typeof connectPeer>> | undefined;
	try {
		peer = await connectPeer(supervisorSocketPath());
		await peer.call("shutdown", {}, timeoutMs);
		return true;
	} catch {
		return false;
	} finally {
		peer?.close();
	}
}

async function prepareSupervisorSocket(): Promise<void> {
	try {
		const peer = await connectPeer(supervisorSocketPath());
		peer.close();
		throw new Error("An xcsh remote supervisor is already running");
	} catch (error) {
		if ((error as Error).message === "An xcsh remote supervisor is already running") throw error;
		if (!["ECONNREFUSED", "ENOENT", "ENOTSOCK"].includes(String((error as NodeJS.ErrnoException).code))) throw error;
	}
	try {
		const entry = await lstat(supervisorSocketPath());
		if (!entry.isSocket() || entry.uid !== process.getuid?.())
			throw new Error("Refusing to replace a non-owned supervisor socket");
		await unlink(supervisorSocketPath());
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

async function spawnSupervisorDetached(): Promise<void> {
	const log = await open(join(root(), "supervisor.log"), "a", 0o600);
	try {
		await log.chmod(0o600);
		const child = spawn(process.execPath, [...sourceArguments(), "remote-control", "supervisor"], {
			detached: true,
			stdio: ["ignore", log.fd, log.fd],
		});
		child.unref();
	} finally {
		await log.close();
	}
}

async function waitForStatus(timeoutMs = 10_000): Promise<Record<string, unknown>> {
	const deadline = Date.now() + timeoutMs;
	do {
		const status = await remoteStatus();
		if (status.hostState === "running" || status.supervisorState === "degraded") return status;
		await Bun.sleep(100);
	} while (Date.now() < deadline);
	const status = await remoteStatus();
	if (status.supervisorState !== "degraded") throw new Error("xcsh remote control failed to start");
	return status;
}

async function runSupervisor(): Promise<void> {
	const state = await readState();
	if (!state?.enabled) return;
	const store = lifecycleStore();
	const previous = await store.readSnapshot();
	const generation = previous?.generation ?? 1;
	const self = await inspectProcess(process.pid, generation);
	if (!self) throw new Error("Unable to identify the xcsh remote supervisor process");
	let initialHost = await store.readRuntime("host");
	if (
		initialHost &&
		!matchesProcessIdentity(initialHost, await inspectProcess(initialHost.pid, initialHost.generation))
	) {
		await store.removeRuntime("host", initialHost);
		initialHost = undefined;
	}
	if (initialHost && initialHost.generation !== generation) {
		await stopManagedHost(initialHost, 60_000);
		await store.removeRuntime("host", initialHost);
		initialHost = undefined;
	}
	if (!initialHost && (await probeHost())) {
		await stopLegacyHost();
		const deadline = Date.now() + 65_000;
		while ((await probeHost()) && Date.now() < deadline) await Bun.sleep(50);
		if (await probeHost()) throw new Error("Unable to stop the unowned xcsh remote host safely");
	}
	const supervisor = new RemoteSupervisor({
		store,
		generation,
		initialSnapshot: previous
			? {
					...previous,
					supervisorState: previous.supervisorState === "degraded" ? "degraded" : "starting",
					startupManager: previous.startupManager,
				}
			: { ...stoppedLifecycle(true), generation, supervisorState: "starting" },
		spawnHost: spawnManagedHost,
		probeHost,
		isHostAlive: async record => matchesProcessIdentity(record, await inspectProcess(record.pid, record.generation)),
		stopHost: stopManagedHost,
		initialHost,
		startupManager: previous?.startupManager ?? (process.platform === "linux" ? "systemd-user" : "process"),
	});
	let stopping = false;
	let wake = Promise.withResolvers<void>();
	const requestStop = () => {
		stopping = true;
		wake.resolve();
	};
	await prepareSupervisorSocket();
	const supervisorPeers = new Set<Awaited<ReturnType<typeof connectPeer>>>();
	const server = await listenLocal(supervisorSocketPath(), peer => {
		supervisorPeers.add(peer);
		peer.onClose = () => supervisorPeers.delete(peer);
		peer.handle = async method => {
			if (method === "status") return supervisor.status();
			if (method !== "shutdown") throw new Error("Unsupported supervisor method");
			setTimeout(requestStop, 20);
			return {};
		};
	});
	process.once("SIGTERM", requestStop);
	process.once("SIGINT", requestStop);
	let operationError: unknown;
	try {
		// Publish the supervisor identity only after winning the socket bind. A losing
		// concurrent contender must never overwrite the live owner's record.
		await store.writeRuntime("supervisor", self);
		while (!stopping) {
			const current = await readState();
			if (!current?.enabled) break;
			await supervisor.checkHost();
			wake = Promise.withResolvers<void>();
			await Promise.race([Bun.sleep(2_000), wake.promise]);
		}
	} catch (error) {
		operationError = error;
	}
	let cleanupError: unknown;
	try {
		await supervisor.shutdown();
	} catch (error) {
		cleanupError = error;
	}
	for (const peer of supervisorPeers) peer.close();
	try {
		await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
	} catch (error) {
		cleanupError ??= error;
	}
	try {
		await store.removeRuntime("supervisor", self);
	} catch (error) {
		cleanupError ??= error;
	}
	process.removeListener("SIGTERM", requestStop);
	process.removeListener("SIGINT", requestStop);
	if (operationError && cleanupError)
		throw new AggregateError([operationError, cleanupError], "xcsh remote supervisor and cleanup failed");
	if (operationError) throw operationError;
	if (cleanupError) throw cleanupError;
}
export async function remoteStatus(): Promise<Record<string, unknown>> {
	const state = await readState();
	const store = lifecycleStore();
	const lifecycle = (await store.readSnapshot()) ?? stoppedLifecycle(state?.enabled ?? false);
	const supervisorRecord = await store.readRuntime("supervisor");
	const supervisorAlive = supervisorRecord
		? matchesProcessIdentity(
				supervisorRecord,
				await inspectProcess(supervisorRecord.pid, supervisorRecord.generation),
			)
		: false;
	try {
		const peer = await connectPeer(remoteSocketPath());
		try {
			return {
				...((await peer.call("status", {})) as Record<string, unknown>),
				enabled: state?.enabled ?? false,
				...lifecycle,
				supervisorState: supervisorAlive ? lifecycle.supervisorState : "stopped",
				hostState: "running",
			};
		} finally {
			peer.close();
		}
	} catch {
		return {
			enabled: state?.enabled ?? false,
			relay: "stopped",
			liveSessions: 0,
			sessions: [],
			...lifecycle,
			supervisorState: supervisorAlive ? lifecycle.supervisorState : "stopped",
			hostState: lifecycle.supervisorState === "degraded" ? "unhealthy" : "stopped",
		};
	}
}
export interface RemoteControlOptions extends ClientListOptions {
	clientId?: string;
}
export async function runRemoteControl(action: string, options: RemoteControlOptions = {}): Promise<unknown> {
	if (action === "revoke" && !options.clientId?.trim())
		throw new Error("An explicit remote client identity is required");
	if (action === "clients" || action === "revoke") {
		const state = await readState();
		if (!state) throw new Error("Enroll an xcsh remote host before managing its clients");
		const storage = await AuthStorage.create(getAgentDbPath());
		try {
			await storage.reload();
			const sessionId = `xcsh-remote-${state.installationId}`;
			const deps = {
				authenticate: (previous?: import("./enrollment").SubscriptionAuth) =>
					previous
						? recoverRemoteSubscription(storage, sessionId, previous)
						: loadRemoteSubscription(storage, sessionId),
			};
			return action === "clients"
				? await listRemoteClients(state.enrollment.environment_id, options, deps)
				: await revokeRemoteClient(state.enrollment.environment_id, options.clientId!, deps);
		} finally {
			storage.close();
		}
	}
	if (action === "status") return remoteStatus();
	if (action === "disable") {
		return withLifecycleLock(root(), async () => {
			const state = await readState();
			if (state) await writeState({ ...state, enabled: false });
			const store = lifecycleStore();
			const manager = startupManager();
			const managed = await manager.available();
			const requested = await requestSupervisorShutdown();
			const supervisor = await store.readRuntime("supervisor");
			if (requested && supervisor) await waitForProcessExit(supervisor.pid, supervisor.generation, 85_000);
			if (managed) await manager.disable();
			else if (!requested) {
				if (supervisor) {
					if (await signalVerifiedProcess(supervisor, "SIGTERM"))
						await waitForProcessExit(supervisor.pid, supervisor.generation, 70_000);
				} else await stopLegacyHost();
			}
			const host = await store.readRuntime("host");
			if (host && (await inspectProcess(host.pid, host.generation))) await stopManagedHost(host, 60_000);
			if (host && !(await inspectProcess(host.pid, host.generation))) await store.removeRuntime("host", host);
			const remainingSupervisor = await store.readRuntime("supervisor");
			if (remainingSupervisor && !(await inspectProcess(remainingSupervisor.pid, remainingSupervisor.generation)))
				await store.removeRuntime("supervisor", remainingSupervisor);
			const previous = await store.readSnapshot();
			await store.writeSnapshot({
				...(previous ?? stoppedLifecycle(false)),
				supervisorState: "stopped",
				hostState: "stopped",
				startupManager: managed ? "systemd-user" : (previous?.startupManager ?? "process"),
				degradedReason: null,
			});
			return { enabled: false };
		});
	}
	if (action === "pair") {
		const state = await readState();
		if (!state?.enabled) throw new Error("Enable xcsh remote control first");
		if ((await remoteStatus()).relay !== "connected")
			throw new Error("Wait for the xcsh remote relay to connect before pairing");
		state.name = state.name.replace(/xcsh/gi, "xcsh");
		if (Date.parse(state.enrollment.expires_at) < Date.now() + 60_000) await refreshState(state);
		return startPairing(state.enrollment);
	}
	if (action === "host") {
		const state = await readState();
		if (!state?.enabled) throw new Error("xcsh remote control is disabled");
		const host = await startLocalHost(remoteSocketPath(), VERSION);
		process.once("SIGTERM", () => {
			void host.close();
		});
		process.once("SIGINT", () => {
			void host.close();
		});
		host.connectRelay(state.enrollment, state.installationId, state.name, () => refreshState(state));
		return undefined;
	}
	if (action === "supervisor") {
		await runSupervisor();
		return undefined;
	}
	if (action !== "enable" && action !== "restart")
		throw new Error("Unsupported remote action in the interoperability preview");
	return withLifecycleLock(root(), async () => {
		let state = await readState();
		const priorState = state ? structuredClone(state) : undefined;
		const wasEnabled = state?.enabled === true;
		if (!state) {
			if (action === "restart") throw new Error("Enroll an xcsh remote host before restarting it");
			await mkdir(root(), { recursive: true, mode: 0o700 });
			// Reuse the explicitly created first-gate enrollment instead of creating another server.
			const gates = (await readdir(root())).filter(name => name.startsWith("gate-"));
			if (gates.length > 1) throw new Error("Multiple gate enrollments; select one before enabling");
			if (gates.length === 1) {
				const gate = (await Bun.file(join(root(), gates[0], "enrollment.json")).json()) as Enrollment & {
					installationId: string;
				};
				const { installationId, ...enrollment } = gate;
				state = { enabled: true, name: `xcsh · ${hostname()}`, installationId, enrollment };
			} else {
				const storage = await AuthStorage.create(getAgentDbPath());
				try {
					await storage.reload();
					const installationId = crypto.randomUUID();
					const name = `xcsh · ${hostname()}`;
					const enrollment = await enrollRemoteHost(
						{
							name,
							installationId,
							version: VERSION,
							os: process.platform,
							arch: process.arch === "x64" ? "x86_64" : "aarch64",
						},
						await loadRemoteSubscription(storage, `xcsh-remote-${installationId}`),
					);
					state = { enabled: true, name, installationId, enrollment };
				} finally {
					storage.close();
				}
			}
		}
		state.name = state.name.replace(/xcsh/gi, "xcsh");
		if (Date.parse(state.enrollment.expires_at) < Date.now() + 60_000) await refreshState(state);
		await writeState({ ...state, enabled: true });
		const store = lifecycleStore();
		const previous = await store.readSnapshot();
		const resetRequested = action === "restart" || !wasEnabled || previous?.supervisorState === "degraded";
		const generation = resetRequested ? (previous?.generation ?? 0) + 1 : (previous?.generation ?? 1);
		const manager = startupManager();
		const managed = await manager.available();
		const next: LifecycleSnapshot = {
			generation,
			restartCount: previous?.restartCount ?? 0,
			supervisorState: "starting",
			hostState: (await probeHost()) ? "running" : "stopped",
			startupManager: managed ? "systemd-user" : "process",
			degradedReason: null,
		};
		try {
			return await store.transitionSnapshot(next, async () => {
				if (action === "restart") {
					const supervisor = await store.readRuntime("supervisor");
					const requested = await requestSupervisorShutdown();
					if (requested && supervisor) await waitForProcessExit(supervisor.pid, supervisor.generation, 85_000);
					if (!requested && (!supervisor || !(await inspectProcess(supervisor.pid, supervisor.generation))))
						await stopLegacyHost();
					if (managed) await manager.restart();
					else {
						if (!requested && supervisor) {
							await signalVerifiedProcess(supervisor, "SIGTERM");
							await waitForProcessExit(supervisor.pid, supervisor.generation, 10_000);
						}
						await spawnSupervisorDetached();
					}
				} else if (managed) {
					if (resetRequested && wasEnabled) await manager.restart();
					else await manager.enable();
				} else {
					const supervisor = await store.readRuntime("supervisor");
					if (!supervisor || !(await inspectProcess(supervisor.pid, supervisor.generation)))
						await spawnSupervisorDetached();
				}
				return waitForStatus();
			});
		} catch (error) {
			await writeState({ ...state, enabled: priorState?.enabled ?? false });
			throw error;
		}
	});
}
