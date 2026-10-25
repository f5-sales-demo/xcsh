import { randomUUID } from "node:crypto";
import {
	computeManifestDiff,
	type HttpTransportRequest,
	immutableGroups,
	type ManifestValidationResult,
	type OpenAPISpec,
	type OperationResult,
	objectValue,
	parseManifests,
	type ResolvedKind,
	ResourceClient,
	type ResourceManifest,
	type ResourceOperationItem,
	type ResourceOperationReport,
	validateBody,
	validateManifest,
} from "@f5-sales-demo/pi-resource-management";
import { getCapabilities, kindResolver, specification } from "./specification.js";
import { SingleAttemptTransport } from "./transport.js";
import type {
	Binding,
	ContextSnapshot,
	CoreHost,
	CoreReceipt,
	MutationOperation,
	PlanEntry,
	ValidatedPlan,
} from "./types.js";
import { CoreRedactor, cloneJson, digest, freezeJson, SecretReferenceError } from "./util.js";

export class F5CoreError extends Error {
	constructor(
		readonly code: string,
		readonly completed = 0,
	) {
		super(code);
		this.name = "F5CoreError";
	}
}
interface BoundContext {
	snapshot: ContextSnapshot;
	fingerprint: string;
	conversation: string;
	redactor: CoreRedactor;
}
interface PreparedEntry {
	manifest: ResourceManifest;
	resolved: ResolvedKind;
	view: PlanEntry;
	currentHash: string | null;
}
interface StoredPlan {
	view: ValidatedPlan;
	entries: PreparedEntry[];
	credentialHash: string;
	state: "prepared" | "consumed";
}
interface Attempt {
	entry: PreparedEntry;
	dispatched: boolean;
	blocked?: F5CoreError;
}
const normalize = (value: string) =>
	value.replace(/\{metadata\.namespace\}/g, "{namespace}").replace(/\{metadata\.name\}/g, "{name}");
const methods = { create: "POST", update: "PUT", delete: "DELETE" } as const;

/** Await host work without admitting a late approval after cancellation. */
async function cancellable<T>(work: () => Promise<T> | T, signal: AbortSignal): Promise<T> {
	if (signal.aborted) throw new F5CoreError("CANCELED");
	return await new Promise<T>((resolve, reject) => {
		const abort = () => {
			signal.removeEventListener("abort", abort);
			reject(new F5CoreError("CANCELED"));
		};
		signal.addEventListener("abort", abort, { once: true });
		Promise.resolve()
			.then(() => {
				if (signal.aborted) throw new F5CoreError("CANCELED");
				return work();
			})
			.then(
				value => {
					signal.removeEventListener("abort", abort);
					signal.aborted ? reject(new F5CoreError("CANCELED")) : resolve(value);
				},
				error => {
					signal.removeEventListener("abort", abort);
					reject(error);
				},
			);
	});
}
function requestBody(manifest: ResourceManifest, namespace: string): Record<string, unknown> {
	const { kind: _kind, ...rest } = manifest.rawObject;
	return { ...rest, metadata: { ...objectValue(rest.metadata), namespace } };
}
function requestUrl(snapshot: ContextSnapshot, template: string, name: string): string {
	const resolved = template
		.replace(/\{namespace\}/g, encodeURIComponent(snapshot.namespace))
		.replace(/\{name\}/g, encodeURIComponent(name));
	if (!resolved.startsWith("/api/") || /[{}]/.test(resolved)) throw new F5CoreError("UNSUPPORTED_OPERATION");
	const literalNamespace = /\/namespaces\/([^/]+)/.exec(template)?.[1];
	if (literalNamespace && !literalNamespace.includes("{") && literalNamespace !== snapshot.namespace) {
		throw new F5CoreError("NAMESPACE_MISMATCH");
	}
	return snapshot.apiUrl.replace(/\/+$/, "") + resolved;
}
function schemaFor(
	resolved: ResolvedKind,
	action: "create" | "update" | "delete",
): { spec: OpenAPISpec; schema?: Record<string, unknown> } {
	const target = normalize(resolved.paths[action]);
	for (const spec of Object.values(specification.specs)) {
		for (const [template, operations] of Object.entries(spec.paths)) {
			const operation = operations[methods[action].toLowerCase()];
			if (!operation || normalize(template) !== target) continue;
			const content = operation.requestBody?.content as Record<string, Record<string, unknown>> | undefined;
			const schema = content?.["application/json"]?.schema;
			if (action !== "delete" && (!schema || typeof schema !== "object")) continue;
			return { spec, schema: schema as Record<string, unknown> | undefined };
		}
	}
	throw new F5CoreError("UNSUPPORTED_OPERATION");
}
function assertImmutable(
	current: Record<string, unknown>,
	desired: Record<string, unknown>,
	resolved: ResolvedKind,
): void {
	const { spec, schema } = schemaFor(resolved, "update");
	if (!schema) throw new F5CoreError("UNSUPPORTED_OPERATION");
	for (const group of immutableGroups(schema, spec)) {
		const at = (value: Record<string, unknown>): Record<string, unknown> | undefined => {
			let owner: unknown = value;
			for (const key of group.path) {
				if (!owner || typeof owner !== "object") return undefined;
				owner = (owner as Record<string, unknown>)[key];
			}
			return owner && typeof owner === "object" ? (owner as Record<string, unknown>) : undefined;
		};
		const oldOwner = at(current),
			newOwner = at(desired);
		const oldSelection = group.members.filter(member => oldOwner?.[member] != null);
		const newSelection = group.members.filter(member => newOwner?.[member] != null);
		if (!oldSelection.length && !newSelection.length) continue;
		if (oldSelection.length !== 1 || newSelection.length !== 1 || oldSelection[0] !== newSelection[0]) {
			throw new F5CoreError("IMMUTABLE_CHANGE");
		}
	}
}

/** Workspace-owned service. The model supplies manifests and opaque handles, never credentials or destinations. */
export class F5Core {
	#bindings = new Map<string, BoundContext>();
	#plans = new Map<string, StoredPlan>();
	#lifetime = new AbortController();
	constructor(private readonly host: CoreHost) {}
	dispose(): void {
		this.#lifetime.abort();
		for (const binding of this.#bindings.values()) binding.redactor.clear();
		this.#bindings.clear();
		this.#plans.clear();
	}
	#signal(signal?: AbortSignal): AbortSignal {
		return signal ? AbortSignal.any([signal, this.#lifetime.signal]) : this.#lifetime.signal;
	}
	#snapshot(signal: AbortSignal): ContextSnapshot {
		if (signal.aborted) throw new F5CoreError("CANCELED");
		let input: ContextSnapshot;
		try {
			input = this.host.getContext(signal);
		} catch {
			throw new F5CoreError("CONTEXT_UNAVAILABLE");
		}
		if (input?.active !== true) throw new F5CoreError("NO_ACTIVE_CONTEXT");
		const { active, workspaceId, contextId, revision, apiUrl, namespace } = input;
		if (
			![workspaceId, contextId, revision, apiUrl, namespace].every(
				value => typeof value === "string" && value.length > 0,
			)
		) {
			throw new F5CoreError("INVALID_CONTEXT");
		}
		let url: URL;
		try {
			url = new URL(apiUrl);
		} catch {
			throw new F5CoreError("INVALID_CONTEXT");
		}
		if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
			throw new F5CoreError("INVALID_CONTEXT");
		}
		return freezeJson({ active, workspaceId, contextId, revision, apiUrl: url.origin, namespace });
	}
	async bind(conversation: string): Promise<Binding> {
		if (typeof conversation !== "string" || !conversation) throw new F5CoreError("INVALID_CONVERSATION");
		const snapshot = this.#snapshot(this.#signal());
		const id = randomUUID();
		this.#bindings.set(id, { snapshot, fingerprint: digest(snapshot), conversation, redactor: new CoreRedactor() });
		return freezeJson({ id });
	}
	#bound(binding: Binding, signal: AbortSignal): BoundContext {
		if (signal.aborted) throw new F5CoreError("CANCELED");
		const bound = this.#bindings.get(binding?.id);
		if (!bound) throw new F5CoreError("INVALID_BINDING");
		if (digest(this.#snapshot(signal)) !== bound.fingerprint) throw new F5CoreError("STALE_BINDING");
		return bound;
	}
	async discover(binding: Binding, signal?: AbortSignal): Promise<{ specificationHash: string; kinds: string[] }> {
		this.#bound(binding, this.#signal(signal));
		return { specificationHash: getCapabilities().specificationHash, kinds: kindResolver.getAllKnownKinds() };
	}
	async describe(
		binding: Binding,
		kind: string,
		options: { operation?: "create" | "update"; field?: string } = {},
		signal?: AbortSignal,
	): Promise<unknown> {
		this.#bound(binding, this.#signal(signal));
		if (
			typeof kind !== "string" ||
			(options.field !== undefined && (typeof options.field !== "string" || options.field.length > 256)) ||
			(options.operation !== undefined && !["create", "update"].includes(options.operation))
		)
			throw new F5CoreError("INVALID_OPERATION");
		let resolved: ResolvedKind;
		try {
			resolved = kindResolver.resolveKind(kind);
		} catch {
			throw new F5CoreError("UNKNOWN_KIND");
		}
		const operation = options.operation ?? "create";
		const fields = new Map<string, unknown>();
		for (const category of Object.values(specification.catalog))
			for (const entry of category.operations) {
				if (
					entry.method.toUpperCase() !== methods[operation] ||
					normalize(entry.path) !== resolved.paths[operation]
				)
					continue;
				for (const [field, metadata] of Object.entries(entry.fieldMetadata ?? {})) {
					if (
						options.field
							? field !== options.field && !field.startsWith(`${options.field}.`)
							: field.split(".").length > 2
					)
						continue;
					fields.set(field, { path: field, ...metadata });
				}
			}
		const { spec, schema } = schemaFor(resolved, operation);
		return {
			specificationHash: getCapabilities().specificationHash,
			kind,
			operation,
			paths: resolved.paths,
			requiredFields: resolved.validation?.[operation] ?? resolved.validation?.minimum_config ?? [],
			immutableSelections: schema ? immutableGroups(schema, spec) : [],
			fields: [...fields.values()].slice(0, 32),
			truncated: fields.size > 32,
		};
	}
	async validate(
		binding: Binding,
		objects: Record<string, unknown>[],
		operation: "create" | "update" | "identity" = "create",
		signal?: AbortSignal,
	): Promise<ManifestValidationResult[]> {
		const bound = this.#bound(binding, this.#signal(signal));
		let manifests: ResourceManifest[];
		try {
			manifests = parseManifests(bound.redactor.restore(cloneJson(objects)), "editor-input");
		} catch (error) {
			throw new F5CoreError(
				error instanceof SecretReferenceError ? "SECRET_REFERENCE_UNAVAILABLE" : "INVALID_MANIFEST",
			);
		}
		bound.redactor.collect(manifests.map(manifest => manifest.rawObject));
		return bound.redactor.redact(
			manifests.map(manifest => {
				if (manifest.metadata.namespace && manifest.metadata.namespace !== bound.snapshot.namespace)
					throw new F5CoreError("NAMESPACE_MISMATCH");
				const validated = validateManifest(manifest, kindResolver, bound.snapshot.namespace, { operation });
				if (validated.resolved && operation !== "identity") {
					const contract = schemaFor(validated.resolved, operation === "update" ? "update" : "create");
					requestUrl(
						bound.snapshot,
						validated.resolved.paths[operation === "update" ? "update" : "create"],
						manifest.metadata.name,
					);
					if (contract.schema)
						for (const message of validateBody(
							requestBody(manifest, bound.snapshot.namespace),
							contract.schema,
							contract.spec,
						)) {
							validated.result.errors.push({
								path: message.split(":")[0] ?? "body",
								message,
								code: "INVALID_TYPE",
							});
						}
					validated.result.valid = validated.result.errors.length === 0;
				}
				return validated.result;
			}),
		);
	}
	async #credentials(bound: BoundContext, signal: AbortSignal): Promise<string> {
		try {
			const credential = await cancellable(() => this.host.getCredentials(bound.snapshot, signal), signal);
			if (typeof credential.apiToken !== "string" || !credential.apiToken) throw new Error("Missing credential");
			bound.redactor.add(credential.apiToken);
			return credential.apiToken;
		} catch (error) {
			if (error instanceof F5CoreError) throw error;
			throw new F5CoreError("CREDENTIALS_UNAVAILABLE");
		}
	}
	async #client(
		binding: Binding,
		signal: AbortSignal,
		attempt?: Attempt,
		credentialHash?: string,
	): Promise<{ client: ResourceClient; credentialHash: string }> {
		const bound = this.#bound(binding, signal);
		const token = await this.#credentials(bound, signal);
		if (credentialHash && digest(token) !== credentialHash) throw new F5CoreError("CREDENTIALS_CHANGED");
		this.#bound(binding, signal);
		const transport = this.host.transport ?? new SingleAttemptTransport(token, signal);
		const client = new ResourceClient({
			apiUrl: bound.snapshot.apiUrl,
			apiToken: token,
			namespace: bound.snapshot.namespace,
			transport: {
				request: async (request: HttpTransportRequest) => {
					try {
						this.#bound(binding, signal);
						if (request.method !== "GET") {
							if (!attempt || attempt.dispatched || attempt.entry.view.action === "unchanged")
								throw new F5CoreError("UNPLANNED_MUTATION");
							const action = attempt.entry.view.action;
							const expectedBody =
								action === "delete" ? null : requestBody(attempt.entry.manifest, bound.snapshot.namespace);
							if (
								request.method !== methods[action] ||
								request.url !==
									requestUrl(
										bound.snapshot,
										attempt.entry.resolved.paths[action],
										attempt.entry.manifest.metadata.name,
									) ||
								digest(request.body ?? null) !== digest(expectedBody)
							)
								throw new F5CoreError("PLAN_CHANGED");
						}
						const response = await cancellable(() => {
							this.#bound(binding, signal);
							if (request.method !== "GET") attempt!.dispatched = true;
							return transport.request(request);
						}, signal);
						if (request.method === "GET" && attempt && !attempt.dispatched) {
							if (response.httpStatus === 401 || response.httpStatus === 403)
								throw new F5CoreError("CREDENTIALS_REJECTED");
							const body =
								attempt.entry.resolved.kind === "certificate" && response.body?.replace_form
									? objectValue(response.body.replace_form)
									: response.body;
							if (
								(response.httpStatus === 404
									? null
									: response.httpStatus === 200
										? digest(body)
										: "unavailable") !== attempt.entry.currentHash
							) {
								throw new F5CoreError("STALE_RESOURCE");
							}
						}
						return response;
					} catch (error) {
						if (attempt && error instanceof F5CoreError && !attempt.dispatched) attempt.blocked = error;
						throw error;
					}
				},
			},
		});
		return { client, credentialHash: digest(token) };
	}
	async inspect(binding: Binding, kind: string, name?: string, signal?: AbortSignal): Promise<unknown> {
		const active = this.#signal(signal),
			bound = this.#bound(binding, active);
		if (typeof kind !== "string" || (name !== undefined && typeof name !== "string"))
			throw new F5CoreError("INVALID_OPERATION");
		let arguments_: { kind: string; name: string | null };
		try {
			arguments_ = bound.redactor.restore({ kind, name: name ?? null });
		} catch {
			throw new F5CoreError("SECRET_REFERENCE_UNAVAILABLE");
		}
		kind = arguments_.kind;
		name = arguments_.name ?? undefined;
		let resolved: ResolvedKind;
		try {
			resolved = kindResolver.resolveKind(kind);
		} catch {
			throw new F5CoreError("UNKNOWN_KIND");
		}
		requestUrl(bound.snapshot, name ? resolved.paths.get : resolved.paths.list, name ?? "");
		const { client } = await this.#client(binding, active);
		const result = await client.get(resolved, name);
		this.#bound(binding, active);
		if (result.error) throw new F5CoreError(result.error.kind === "auth" ? "CREDENTIALS_REJECTED" : "READ_FAILED");
		bound.redactor.collect(result);
		return bound.redactor.redact(result);
	}
	async #save(
		plan: ValidatedPlan,
		stage: CoreReceipt["stage"],
		completed: number,
		code?: string,
		signal?: AbortSignal,
	): Promise<void> {
		try {
			await cancellable(
				() =>
					this.host.persist({
						schemaVersion: 1,
						planId: plan.id,
						planHash: plan.hash,
						binding: plan.binding,
						stage,
						completed,
						...(code ? { code } : {}),
					}),
				signal ?? this.#lifetime.signal,
			);
		} catch (error) {
			if (error instanceof F5CoreError) throw error;
			throw new F5CoreError("PERSISTENCE_FAILED", completed);
		}
	}
	async plan(
		binding: Binding,
		operation: MutationOperation,
		objects: Record<string, unknown>[],
		signal?: AbortSignal,
	): Promise<ValidatedPlan> {
		const active = this.#signal(signal),
			bound = this.#bound(binding, active);
		if (!["apply", "create", "update", "delete"].includes(operation)) throw new F5CoreError("INVALID_OPERATION");
		const validation = await this.validate(
			binding,
			objects,
			operation === "delete" ? "identity" : operation === "update" ? "update" : "create",
			active,
		);
		if (!objects.length || validation.some(result => !result.valid)) throw new F5CoreError("VALIDATION_FAILED");
		const manifests = parseManifests(bound.redactor.restore(cloneJson(objects)), "editor-input");
		const identities = manifests.map(manifest => `${manifest.kind}/${manifest.metadata.name}`);
		if (new Set(identities).size !== identities.length) throw new F5CoreError("DUPLICATE_RESOURCE");
		const { client, credentialHash } = await this.#client(binding, active);
		const entries: PreparedEntry[] = [];
		for (const manifest of manifests) {
			const resolved = kindResolver.resolveKind(manifest.kind);
			requestUrl(bound.snapshot, resolved.paths.get, manifest.metadata.name);
			const current = await client.inspectForMutation(resolved, manifest.metadata.name);
			this.#bound(binding, active);
			if (current.status !== 404 && (current.error || !current.body))
				throw new F5CoreError(current.error?.kind === "auth" ? "CREDENTIALS_REJECTED" : "READ_FAILED");
			const exists = current.status !== 404;
			if (operation === "create" && exists) throw new F5CoreError("RESOURCE_EXISTS");
			if ((operation === "update" || operation === "delete") && !exists) throw new F5CoreError("RESOURCE_NOT_FOUND");
			const action = operation === "apply" ? (exists ? "update" : "create") : operation;
			const contract = schemaFor(resolved, action);
			requestUrl(bound.snapshot, resolved.paths[action], manifest.metadata.name);
			const body = requestBody(manifest, bound.snapshot.namespace);
			if (action !== "delete" && contract.schema && validateBody(body, contract.schema, contract.spec).length)
				throw new F5CoreError("VALIDATION_FAILED");
			if (exists) {
				const metadata = current.body!.metadata as Record<string, unknown> | undefined;
				const system = current.body!.system_metadata as Record<string, unknown> | undefined;
				if (metadata?.name !== manifest.metadata.name || metadata?.namespace !== bound.snapshot.namespace)
					throw new F5CoreError("RESOURCE_IDENTITY_MISMATCH");
				if (
					typeof system?.uid !== "string" ||
					!system.uid ||
					typeof (current.body!.resource_version ?? system.resource_version) !== "string" ||
					!(current.body!.resource_version ?? system.resource_version)
				)
					throw new F5CoreError("RESOURCE_IDENTITY_UNAVAILABLE");
			}
			if (action === "update") assertImmutable(current.body!, body, resolved);
			const changes = exists && action !== "delete" ? computeManifestDiff(current.body!, manifest) : undefined;
			const view: PlanEntry = {
				kind: manifest.kind,
				name: manifest.metadata.name,
				namespace: bound.snapshot.namespace,
				action: changes && !changes.hasDifferences ? "unchanged" : action,
				...(changes ? { changes } : {}),
			};
			bound.redactor.collect(current.body);
			entries.push(freezeJson({ manifest, resolved, view, currentHash: exists ? digest(current.body) : null }));
		}
		const id = randomUUID();
		const hash = digest({
			id,
			binding: binding.id,
			conversation: bound.conversation,
			context: bound.fingerprint,
			credentialHash,
			operation,
			specificationHash: getCapabilities().specificationHash,
			entries: entries.map(entry => ({
				body: entry.manifest.rawObject,
				state: entry.currentHash,
				action: entry.view.action,
				paths: entry.resolved.paths,
			})),
		});
		const view = freezeJson({
			schemaVersion: 1 as const,
			id,
			hash,
			binding: binding.id,
			specificationHash: getCapabilities().specificationHash,
			operation,
			entries: entries.map(({ view }) => ({ ...bound.redactor.redact(view), kind: view.kind, action: view.action })),
		});
		await this.#save(view, "prepared", 0, undefined, active);
		this.#bound(binding, active);
		this.#plans.set(id, { view, entries, credentialHash, state: "prepared" });
		return view;
	}
	async execute(binding: Binding, planId: string, signal?: AbortSignal): Promise<ResourceOperationReport> {
		const active = this.#signal(signal);
		const plan = this.#plans.get(planId);
		if (!plan) throw new F5CoreError("UNKNOWN_PLAN");
		if (plan.view.binding !== binding.id) throw new F5CoreError("PLAN_BINDING_MISMATCH");
		if (plan.state !== "prepared") throw new F5CoreError("PLAN_CONSUMED");
		plan.state = "consumed";
		let completed = 0,
			attempt: Attempt | undefined;
		const results: ResourceOperationItem[] = [];
		try {
			const bound = this.#bound(binding, active);
			const approval = await cancellable(() => this.host.approve(plan.view, active), active);
			if (approval?.approved !== true) throw new F5CoreError("APPROVAL_CANCELED");
			if (approval.planHash !== plan.view.hash) throw new F5CoreError("APPROVAL_MISMATCH");
			this.#bound(binding, active);
			await this.#save(plan.view, "authorized", 0, undefined, active);
			for (const entry of plan.entries) {
				attempt = { entry, dispatched: false };
				const { client } = await this.#client(binding, active, attempt, plan.credentialHash);
				const before = await client.inspectForMutation(entry.resolved, entry.manifest.metadata.name);
				if (attempt.blocked) throw attempt.blocked;
				if (before.error && before.status !== 404) throw new F5CoreError("READ_FAILED");
				let result: OperationResult;
				if (entry.view.action === "unchanged") result = { status: "unchanged", resource: before.body! };
				else {
					await this.#save(plan.view, "dispatching", completed, undefined, active);
					this.#bound(binding, active);
					if (entry.view.action === "create") result = await client.create(entry.manifest, entry.resolved);
					else if (entry.view.action === "update") result = await client.update(entry.manifest, entry.resolved);
					else result = await client.delete(entry.manifest.kind, entry.manifest.metadata.name, entry.resolved);
					if (attempt.blocked) throw attempt.blocked;
					if (result.status === "error") {
						if (
							result.error.kind === "network" ||
							result.error.httpStatus === 408 ||
							result.error.httpStatus === 429 ||
							(result.error.httpStatus ?? 0) >= 500
						)
							throw new F5CoreError("UNCERTAIN_MUTATION", completed);
						throw new F5CoreError(
							result.error.kind === "auth" ? "CREDENTIALS_REJECTED" : "MUTATION_REJECTED",
							completed,
						);
					}
					const after = await client.inspectForMutation(entry.resolved, entry.manifest.metadata.name);
					const afterSystem = after.body?.system_metadata as Record<string, unknown> | undefined;
					const beforeSystem = before.body?.system_metadata as Record<string, unknown> | undefined;
					const afterVersion = after.body?.resource_version ?? afterSystem?.resource_version;
					if (
						entry.view.action === "delete"
							? after.status !== 404
							: after.status !== 200 ||
								!after.body ||
								typeof afterSystem?.uid !== "string" ||
								!afterSystem.uid ||
								typeof afterVersion !== "string" ||
								!afterVersion ||
								(entry.view.action === "update" && beforeSystem?.uid !== afterSystem.uid) ||
								computeManifestDiff(after.body, entry.manifest).hasDifferences
					) {
						throw new F5CoreError("UNCERTAIN_MUTATION", completed);
					}
				}
				completed++;
				results.push({
					index: results.length,
					kind: entry.view.kind,
					name: entry.view.name,
					namespace: entry.view.namespace,
					status: result.status,
					...("resource" in result ? { resource: result.resource } : {}),
					...("diff" in result ? { diff: result.diff } : {}),
				});
				await this.#save(plan.view, "verified", completed, undefined, active);
				attempt = undefined;
			}
			await this.#save(plan.view, "complete", completed, undefined, active);
			bound.redactor.collect(results);
			return {
				schemaVersion: 1,
				operation: plan.view.operation,
				success: true,
				counts: {
					total: results.length,
					succeeded: completed,
					failed: 0,
					...Object.fromEntries(
						[...new Set(results.map(result => result.status))].map(status => [
							status,
							results.filter(result => result.status === status).length,
						]),
					),
				},
				results: results.map(result => ({
					...bound.redactor.redact(result),
					index: result.index,
					kind: result.kind,
					status: result.status,
				})),
			};
		} catch (error) {
			let failure = new F5CoreError(error instanceof F5CoreError ? error.code : "OPERATION_FAILED", completed);
			if (attempt?.dispatched && !["CREDENTIALS_REJECTED", "MUTATION_REJECTED"].includes(failure.code))
				failure = new F5CoreError("UNCERTAIN_MUTATION", completed);
			try {
				await this.#save(
					plan.view,
					failure.code === "UNCERTAIN_MUTATION" ? "uncertain" : "failed",
					completed,
					failure.code,
					AbortSignal.timeout(1000),
				);
			} catch {
				/* No replay is admitted after a persistence failure. */
			}
			throw failure;
		}
	}
}
