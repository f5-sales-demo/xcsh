import { spawn } from "node:child_process";
import { chmod, lstat, mkdir, open, readdir, rename, rmdir, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { AuthStorage } from "@f5-sales-demo/pi-ai";
import { getAgentDbPath, getAgentDir, VERSION } from "@f5-sales-demo/pi-utils";
import { loadRemoteSubscription } from "./auth";
import { remoteSocketPath } from "./bridge";
import { type Enrollment, enrollRemoteHost, refreshRemoteHost } from "./enrollment";
import { startLocalHost } from "./host";
import { connectPeer } from "./ipc";
import { startPairing } from "./pairing";

interface HostState {
	enabled: boolean;
	name: string;
	installationId: string;
	enrollment: Enrollment;
}
const root = () => join(getAgentDir(), "remote-control");
const statePath = () => join(root(), "host.json");
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
export async function remoteStatus(): Promise<Record<string, unknown>> {
	const state = await readState();
	try {
		const peer = await connectPeer(remoteSocketPath());
		try {
			return (await peer.call("status", {})) as Record<string, unknown>;
		} finally {
			peer.close();
		}
	} catch {
		return { enabled: state?.enabled ?? false, relay: "stopped", liveSessions: 0 };
	}
}
export async function runRemoteControl(action: string): Promise<unknown> {
	if (action === "status") return remoteStatus();
	if (action === "disable") {
		const state = await readState();
		if (state) await writeState({ ...state, enabled: false });
		try {
			const peer = await connectPeer(remoteSocketPath());
			try {
				await peer.call("stop", {});
			} finally {
				peer.close();
			}
		} catch {
			/* Already stopped. */
		}
		return { enabled: false };
	}
	if (action === "pair") {
		const state = await readState();
		if (!state?.enabled) throw new Error("Enable XCSH remote control first");
		if ((await remoteStatus()).relay !== "connected")
			throw new Error("Wait for the XCSH remote relay to connect before pairing");
		if (Date.parse(state.enrollment.expires_at) < Date.now() + 60_000) await refreshState(state);
		return startPairing(state.enrollment);
	}
	if (action === "host") {
		const state = await readState();
		if (!state?.enabled) throw new Error("XCSH remote control is disabled");
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
	if (action !== "enable") throw new Error("Unsupported remote action in the interoperability preview");
	if ((await remoteStatus()).relay !== "stopped") return remoteStatus();
	await mkdir(root(), { recursive: true, mode: 0o700 });
	const lockPath = join(root(), "enable.lock");
	await mkdir(lockPath, { mode: 0o700 });
	try {
		let state = await readState();
		if (!state) {
			await mkdir(root(), { recursive: true, mode: 0o700 });
			// Reuse the explicitly created first-gate enrollment instead of creating another server.
			const gates = (await readdir(root())).filter(name => name.startsWith("gate-"));
			if (gates.length > 1) throw new Error("Multiple gate enrollments; select one before enabling");
			if (gates.length === 1) {
				const gate = (await Bun.file(join(root(), gates[0], "enrollment.json")).json()) as Enrollment & {
					installationId: string;
				};
				const { installationId, ...enrollment } = gate;
				state = { enabled: true, name: `XCSH · ${hostname()}`, installationId, enrollment };
			} else {
				const storage = await AuthStorage.create(getAgentDbPath());
				try {
					await storage.reload();
					const installationId = crypto.randomUUID();
					const name = `XCSH · ${hostname()}`;
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
		if (Date.parse(state.enrollment.expires_at) < Date.now() + 60_000) await refreshState(state);
		await writeState({ ...state, enabled: true });
		// Refuse takeover of a responding host; remove only a confirmed stale socket.
		try {
			const peer = await connectPeer(remoteSocketPath());
			peer.close();
			return remoteStatus();
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "ECONNREFUSED" && code !== "ENOENT") throw error;
			// Bun can report ENOENT for a stale filesystem socket.
			try {
				const entry = await lstat(remoteSocketPath());
				if (!entry.isSocket() || entry.uid !== process.getuid?.())
					throw new Error("Refusing to replace a non-owned remote socket");
				await unlink(remoteSocketPath());
			} catch (statError) {
				if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
			}
		}
		const log = await open(join(root(), "host.log"), "a", 0o600);
		try {
			const sourceArgs = process.execPath.endsWith("bun") ? [process.argv[1]] : [];
			const child = spawn(process.execPath, [...sourceArgs, "remote-control", "host"], {
				detached: true,
				stdio: ["ignore", log.fd, log.fd],
			});
			child.unref();
		} finally {
			await log.close();
		}
		const deadline = Date.now() + 10_000;
		while (Date.now() < deadline) {
			const status = await remoteStatus();
			if (status.relay === "connected") return status;
			await Bun.sleep(100);
		}
		return remoteStatus();
	} finally {
		await rmdir(lockPath);
	}
}
