import type {
	IntegrationDefinition,
	IntegrationHandle,
	IntegrationProbeResult,
	IntegrationSetupPlan,
	IntegrationSnapshot,
	IntegrationStatus,
} from "./types";

const LOCAL_TTL_MS = 5 * 60_000;
const NETWORK_TTL_MS = 30 * 60_000;
const FAILURE_INITIAL_MS = 5 * 60_000;
const FAILURE_MAX_MS = 2 * 60 * 60_000;
const RATE_LIMIT_MINIMUM_MS = 60 * 60_000;
const MAX_SETUP_STEP_TIMEOUT_MS = 2 * 60 * 60_000;
const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]*$/;

interface Entry<T = unknown> {
	owner: string;
	definition: Readonly<IntegrationDefinition<T>>;
	handle: IntegrationHandle<T>;
	snapshot?: IntegrationSnapshot<T>;
	expiresAt: number;
	inFlight?: Promise<IntegrationSnapshot<T>>;
	failures: number;
}

function freezeStrings(values: readonly string[]): readonly string[] {
	return Object.freeze([...values]);
}

function freezePlan(plan: IntegrationSetupPlan | undefined): IntegrationSetupPlan | undefined {
	if (!plan) return undefined;
	const frozen: IntegrationSetupPlan = {
		pluginDependencies: freezeStrings(plan.pluginDependencies),
		requiredEnvironment: freezeStrings(plan.requiredEnvironment),
		profileFields: freezeStrings(plan.profileFields),
		steps: Object.freeze(
			plan.steps.map(step =>
				Object.freeze({
					...step,
					argv: freezeStrings(step.argv),
					...(step.environment ? { environment: freezeStrings(step.environment) } : {}),
				}),
			),
		),
		verification: Object.freeze(
			plan.verification.map(step => Object.freeze({ ...step, argv: freezeStrings(step.argv) })),
		),
	};
	return Object.freeze(frozen);
}

function validateArgv(argv: readonly string[]): boolean {
	return Array.isArray(argv) && argv.length > 0 && argv.every(value => typeof value === "string" && value.length > 0);
}

function validatePlan(plan: IntegrationSetupPlan | undefined): void {
	if (!plan) return;
	if (
		!Array.isArray(plan.pluginDependencies) ||
		!Array.isArray(plan.requiredEnvironment) ||
		plan.requiredEnvironment.some(name => !ENVIRONMENT_NAME.test(name)) ||
		!Array.isArray(plan.profileFields) ||
		!Array.isArray(plan.steps) ||
		!Array.isArray(plan.verification) ||
		plan.steps.some(
			step =>
				!step ||
				!(["install", "login"] as const).includes(step.kind) ||
				!validateArgv(step.argv) ||
				!Number.isInteger(step.timeoutMs) ||
				step.timeoutMs < 1_000 ||
				step.timeoutMs > MAX_SETUP_STEP_TIMEOUT_MS ||
				(step.environment?.some((name: string) => !ENVIRONMENT_NAME.test(name)) ?? false),
		) ||
		plan.verification.some(
			step =>
				!step ||
				!validateArgv(step.argv) ||
				!Number.isInteger(step.timeoutMs) ||
				step.timeoutMs < 1_000 ||
				step.timeoutMs > 120_000,
		)
	)
		throw new Error("Invalid integration setup plan");
}

function publicStatus(snapshot: IntegrationSnapshot): IntegrationStatus {
	const { value: _, ...status } = snapshot;
	return status;
}

export class IntegrationRegistry {
	readonly #entries = new Map<string, Entry>();
	readonly #now: () => number;

	constructor(options: { now?: () => number } = {}) {
		this.#now = options.now ?? Date.now;
	}

	register<T>(owner: string, definition: IntegrationDefinition<T>): IntegrationHandle<T> {
		if (
			!owner ||
			!definition ||
			!ID.test(definition.id) ||
			!definition.name.trim() ||
			typeof definition.probe !== "function"
		)
			throw new Error("Invalid integration definition");
		if (definition.dependencies?.some(id => !ID.test(id) || id === definition.id))
			throw new Error("Invalid integration dependencies");
		if (
			definition.successTtlMs !== undefined &&
			(!Number.isInteger(definition.successTtlMs) || definition.successTtlMs < 1_000)
		)
			throw new Error("Invalid integration success TTL");
		validatePlan(definition.setup);
		const existing = this.#entries.get(definition.id);
		if (existing && existing.owner !== owner) throw new Error(`Integration ${definition.id} is already registered`);

		const setupPlan = freezePlan(definition.setup);
		const frozenDefinition = Object.freeze({
			...definition,
			dependencies: definition.dependencies ? freezeStrings(definition.dependencies) : undefined,
			setup: setupPlan,
			probe: definition.probe.bind(definition),
		});
		const handle: IntegrationHandle<T> = Object.freeze({
			id: definition.id,
			name: definition.name,
			plugin: definition.plugin,
			setupPlan,
			get: (signal?: AbortSignal) => this.#get(definition.id, false, signal) as Promise<IntegrationSnapshot<T>>,
			invalidate: () => this.invalidate(definition.id),
			verifyAfterSetup: (reviewedPlan: IntegrationSetupPlan, signal?: AbortSignal) => {
				const current = this.#entries.get(definition.id);
				if (!current?.definition.setup || reviewedPlan !== current.definition.setup)
					throw new Error("Setup requires the current reviewed setup plan");
				return this.#get(definition.id, true, signal) as Promise<IntegrationSnapshot<T>>;
			},
		});
		const entry: Entry<T> = {
			owner,
			definition: frozenDefinition,
			handle,
			expiresAt: 0,
			failures: 0,
		};
		this.#entries.set(definition.id, entry as Entry);
		try {
			this.#assertAcyclic();
		} catch (error) {
			if (existing) this.#entries.set(definition.id, existing);
			else this.#entries.delete(definition.id);
			throw error;
		}
		return handle;
	}

	unregister(owner: string, id: string): boolean {
		const entry = this.#entries.get(id);
		if (!entry || entry.owner !== owner) return false;
		return this.#entries.delete(id);
	}

	unregisterOwner(owner: string): number {
		let removed = 0;
		for (const [id, entry] of this.#entries) {
			if (entry.owner === owner && this.#entries.delete(id)) removed++;
		}
		return removed;
	}

	clear(): void {
		this.#entries.clear();
	}

	list(): IntegrationHandle<unknown>[] {
		return [...this.#entries.values()].map(entry => entry.handle);
	}

	get(id: string): IntegrationHandle<unknown> | undefined {
		return this.#entries.get(id)?.handle;
	}

	async statuses(signal?: AbortSignal): Promise<IntegrationStatus[]> {
		return Promise.all(this.list().map(async handle => publicStatus(await handle.get(signal))));
	}

	invalidate(id: string): void {
		const entry = this.#entries.get(id);
		if (entry) entry.expiresAt = 0;
	}

	#assertAcyclic(): void {
		const visiting = new Set<string>();
		const visited = new Set<string>();
		const visit = (id: string) => {
			if (visiting.has(id)) throw new Error("Invalid integration dependency cycle");
			if (visited.has(id)) return;
			visiting.add(id);
			for (const dependency of this.#entries.get(id)?.definition.dependencies ?? []) {
				if (this.#entries.has(dependency)) visit(dependency);
			}
			visiting.delete(id);
			visited.add(id);
		};
		for (const id of this.#entries.keys()) visit(id);
	}

	async #get(id: string, forceAfterSetup: boolean, signal?: AbortSignal): Promise<IntegrationSnapshot> {
		const entry = this.#entries.get(id);
		if (!entry) throw new Error(`Unknown integration: ${id}`);
		const now = this.#now();
		if (!forceAfterSetup && entry.snapshot && now < entry.expiresAt) return entry.snapshot;
		if (entry.inFlight) return entry.inFlight;
		entry.inFlight = this.#probe(entry, signal).finally(() => {
			entry.inFlight = undefined;
		});
		return entry.inFlight;
	}

	async #probe(entry: Entry, signal?: AbortSignal): Promise<IntegrationSnapshot> {
		const checkedAt = this.#now();
		const startedAt = performance.now();
		let result: IntegrationProbeResult<unknown>;
		try {
			for (const dependency of entry.definition.dependencies ?? []) {
				const dependencyEntry = this.#entries.get(dependency);
				if (!dependencyEntry || (await this.#get(dependency, false, signal)).state !== "ready") {
					result = { state: "unavailable", reason: "dependency_missing" };
					return this.#storeResult(entry, result, checkedAt, startedAt);
				}
			}
			if (signal?.aborted) throw signal.reason;
			result = await entry.definition.probe(signal);
			if (
				!result ||
				!(["ready", "setup_required", "unavailable", "degraded", "rate_limited", "error"] as const).includes(
					result.state,
				)
			)
				throw new Error("Invalid integration probe response");
		} catch {
			result = { state: "error", reason: "invalid_response" };
		}
		return this.#storeResult(entry, result, checkedAt, startedAt);
	}

	#storeResult(
		entry: Entry,
		result: IntegrationProbeResult<unknown>,
		checkedAt: number,
		startedAt: number,
	): IntegrationSnapshot {
		const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
		let retryAt: number | undefined;
		if (result.state === "ready") {
			entry.failures = 0;
			entry.expiresAt =
				checkedAt +
				(entry.definition.successTtlMs ?? (entry.definition.kind === "local" ? LOCAL_TTL_MS : NETWORK_TTL_MS));
		} else if (result.state === "rate_limited") {
			entry.failures++;
			retryAt = checkedAt + Math.max(RATE_LIMIT_MINIMUM_MS, result.retryAfterMs ?? 0);
			entry.expiresAt = retryAt;
		} else {
			entry.failures++;
			const delay = Math.min(FAILURE_MAX_MS, FAILURE_INITIAL_MS * 2 ** (entry.failures - 1));
			retryAt = checkedAt + delay;
			entry.expiresAt = retryAt;
		}
		const snapshot = Object.freeze({
			id: entry.definition.id,
			name: entry.definition.name,
			...(entry.definition.plugin ? { plugin: entry.definition.plugin } : {}),
			state: result.state,
			...(result.reason ? { reason: result.reason } : {}),
			...(result.value !== undefined ? { value: result.value } : {}),
			checkedAt,
			...(retryAt !== undefined ? { retryAt } : {}),
			durationMs,
		});
		entry.snapshot = snapshot;
		return snapshot;
	}
}

export const integrationRegistry = new IntegrationRegistry();
