import { CrashLoopBreaker, type LifecycleSnapshot, type LifecycleStore, type ProcessIdentity } from "./lifecycle-state";
import { ReconnectBackoff } from "./relay-lifecycle";

export interface RemoteSupervisorOptions {
	store: LifecycleStore;
	generation: number;
	spawnHost: (generation: number) => Promise<ProcessIdentity>;
	probeHost: (timeoutMs: number) => Promise<boolean>;
	isHostAlive: (record: ProcessIdentity) => Promise<boolean>;
	stopHost: (record: ProcessIdentity, drainMs: number) => Promise<void>;
	sleep?: (milliseconds: number) => Promise<void>;
	now?: () => number;
	random?: () => number;
	startupTimeoutMs?: number;
	startupPollMs?: number;
	drainMs?: number;
	startupManager?: LifecycleSnapshot["startupManager"];
	initialSnapshot?: LifecycleSnapshot;
	initialHost?: ProcessIdentity;
}

export type SupervisorCheck = "healthy" | "unhealthy" | "restarted" | "degraded";

export class RemoteSupervisor {
	readonly #store: LifecycleStore;
	readonly #spawnHost: RemoteSupervisorOptions["spawnHost"];
	readonly #probeHost: RemoteSupervisorOptions["probeHost"];
	readonly #isHostAlive: RemoteSupervisorOptions["isHostAlive"];
	readonly #stopHost: RemoteSupervisorOptions["stopHost"];
	readonly #sleep: (milliseconds: number) => Promise<void>;
	readonly #now: () => number;
	readonly #startupTimeoutMs: number;
	readonly #startupPollMs: number;
	readonly #drainMs: number;
	readonly #breaker: CrashLoopBreaker;
	readonly #backoff: ReconnectBackoff;
	#record?: ProcessIdentity;
	#starting?: Promise<boolean>;
	#failedProbes = 0;
	#snapshot: LifecycleSnapshot;
	constructor(options: RemoteSupervisorOptions) {
		this.#store = options.store;
		this.#spawnHost = options.spawnHost;
		this.#probeHost = options.probeHost;
		this.#isHostAlive = options.isHostAlive;
		this.#stopHost = options.stopHost;
		this.#sleep = options.sleep ?? Bun.sleep;
		this.#now = options.now ?? Date.now;
		this.#startupTimeoutMs = options.startupTimeoutMs ?? 10_000;
		this.#startupPollMs = options.startupPollMs ?? 100;
		this.#drainMs = options.drainMs ?? 60_000;
		this.#breaker = new CrashLoopBreaker(this.#now);
		this.#backoff = new ReconnectBackoff(options.random);
		this.#snapshot = options.initialSnapshot ?? {
			generation: options.generation,
			restartCount: 0,
			supervisorState: "starting",
			hostState: "stopped",
			startupManager: options.startupManager ?? "process",
			degradedReason: null,
		};
		this.#record = options.initialHost;
		if (this.#snapshot.supervisorState === "degraded" && this.#snapshot.degradedReason)
			this.#breaker.restoreOpen(this.#snapshot.degradedReason);
	}
	async #save(): Promise<void> {
		await this.#store.writeSnapshot(this.#snapshot);
	}
	async status(): Promise<LifecycleSnapshot> {
		return structuredClone(this.#snapshot);
	}
	async ensureHost(): Promise<boolean> {
		if (this.#breaker.isOpen) return false;
		if (this.#record && (await this.#isHostAlive(this.#record))) return true;
		if (this.#starting) return this.#starting;
		this.#starting = this.#start().finally(() => {
			this.#starting = undefined;
		});
		return this.#starting;
	}
	async #start(): Promise<boolean> {
		this.#snapshot.supervisorState = "starting";
		this.#snapshot.hostState = "starting";
		await this.#save();
		let record: ProcessIdentity | undefined;
		try {
			record = await this.#spawnHost(this.#snapshot.generation);
			this.#record = record;
			await this.#store.writeRuntime("host", record);
			const deadline = this.#now() + this.#startupTimeoutMs;
			do {
				if (await this.#probeHost(1_000)) {
					this.#failedProbes = 0;
					this.#backoff.reset();
					this.#snapshot.supervisorState = "running";
					this.#snapshot.hostState = "running";
					this.#snapshot.degradedReason = null;
					await this.#save();
					return true;
				}
				if (this.#now() < deadline) await this.#sleep(this.#startupPollMs);
			} while (this.#now() < deadline);
		} catch {
			// The bounded failure path below records only a sanitized reason.
		}
		if (record) {
			try {
				await this.#stopHost(record, this.#drainMs);
				await this.#store.removeRuntime("host", record);
			} catch {
				this.#record = record;
				return this.#recordFailure("host identity could not be stopped safely");
			}
		}
		this.#record = undefined;
		return this.#recordFailure("host failed to become healthy");
	}
	async #recordFailure(reason: string): Promise<false> {
		this.#snapshot.hostState = "unhealthy";
		if (this.#breaker.recordFailure(reason)) {
			this.#snapshot.supervisorState = "degraded";
			this.#snapshot.degradedReason = this.#breaker.degradedReason;
		} else {
			this.#snapshot.supervisorState = "running";
			this.#snapshot.degradedReason = null;
		}
		await this.#save();
		return false;
	}
	async #replace(reason: string): Promise<SupervisorCheck> {
		const previous = this.#record;
		this.#record = undefined;
		if (previous) {
			try {
				await this.#stopHost(previous, this.#drainMs);
				await this.#store.removeRuntime("host", previous);
			} catch {
				this.#record = previous;
				await this.#recordFailure("host identity could not be stopped safely");
				return "unhealthy";
			}
		}
		this.#snapshot.restartCount++;
		this.#failedProbes = 0;
		if (this.#breaker.recordFailure(reason)) {
			this.#snapshot.supervisorState = "degraded";
			this.#snapshot.hostState = "unhealthy";
			this.#snapshot.degradedReason = this.#breaker.degradedReason;
			await this.#save();
			return "degraded";
		}
		await this.#save();
		await this.#sleep(this.#backoff.nextDelay());
		return (await this.ensureHost()) ? "restarted" : this.#breaker.isOpen ? "degraded" : "unhealthy";
	}
	async checkHost(): Promise<SupervisorCheck> {
		if (this.#breaker.isOpen) return "degraded";
		if (!this.#record && (await this.#probeHost(1_000))) {
			this.#failedProbes = 0;
			this.#snapshot.supervisorState = "running";
			this.#snapshot.hostState = "running";
			await this.#save();
			return "healthy";
		}
		if (!this.#record)
			return (await this.ensureHost()) ? "restarted" : this.#breaker.isOpen ? "degraded" : "unhealthy";
		if (!(await this.#isHostAlive(this.#record))) return this.#replace("host process exited");
		if (await this.#probeHost(1_000)) {
			this.#failedProbes = 0;
			return "healthy";
		}
		this.#failedProbes++;
		if (this.#failedProbes < 3) return "unhealthy";
		return this.#replace("host failed three health probes");
	}
	async reset(generation: number): Promise<void> {
		this.#breaker.reset();
		this.#backoff.reset();
		this.#failedProbes = 0;
		this.#snapshot.generation = generation;
		this.#snapshot.supervisorState = "starting";
		this.#snapshot.hostState = "stopped";
		this.#snapshot.degradedReason = null;
		await this.#save();
	}
	async shutdown(): Promise<void> {
		const record = this.#record;
		this.#record = undefined;
		if (record) {
			await this.#stopHost(record, this.#drainMs);
			await this.#store.removeRuntime("host", record);
		}
		this.#snapshot.supervisorState = "stopped";
		this.#snapshot.hostState = "stopped";
		await this.#save();
	}
}
