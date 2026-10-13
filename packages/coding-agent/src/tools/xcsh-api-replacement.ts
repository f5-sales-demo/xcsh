import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { AgentToolResult } from "@f5-sales-demo/pi-agent-core";
import {
	createBody,
	type MutationContract,
	objectValue,
	selectedMember,
	validateBody,
	valueAt,
} from "../internal-urls/immutable-selection";
import type { XcshApiToolDetails } from "./xcsh-api";

type ObjectValue = Record<string, unknown>;
interface Stage {
	version: 1;
	id: string;
	scope: string;
	resourcePath: string;
	name: string;
	namespace: string;
	originalUid: string;
	originalVersion: string;
	originalSelections: string[];
	targetSelections: string[];
	stage: "prepared" | "deleting" | "absent" | "creating" | "verifying" | "complete";
	newUid?: string;
	serviceState?: string;
	certificateState?: string;
}
interface Options {
	contract: MutationContract;
	apiBase: string;
	contextName?: string;
	resourcePath: string;
	payload: ObjectValue;
	recreate: boolean;
	replacementId?: string;
	headers: Record<string, string>;
	signal?: AbortSignal;
	contextMatches: () => boolean;
	stateDir?: string;
}
class ReplacementError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly status = 409,
	) {
		super(message);
	}
}
function identity(object: ObjectValue, name: string, namespace: string) {
	const meta = objectValue(object.metadata);
	const system = objectValue(object.system_metadata);
	if (meta.name !== name || meta.namespace !== namespace)
		throw new ReplacementError("identity_mismatch", "Readback name or namespace does not match the requested object");
	const uid = system.uid;
	const version = object.resource_version ?? system.resource_version;
	if (typeof uid !== "string" || !uid || typeof version !== "string" || !version)
		throw new ReplacementError("identity_unavailable", "The existing object must have a UID and resource version");
	return { uid, version };
}
function mergeObject(current: ObjectValue, update: ObjectValue): ObjectValue {
	const result = { ...current };
	for (const [key, value] of Object.entries(update)) {
		result[key] =
			value &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			current[key] &&
			typeof current[key] === "object" &&
			!Array.isArray(current[key])
				? mergeObject(objectValue(current[key]), objectValue(value))
				: value;
	}
	return result;
}
function maskSensitiveDiagnostic(raw: string, payload: unknown): string {
	const secrets: string[] = [];
	const visit = (value: unknown, sensitive = false) => {
		if (typeof value === "string") {
			if (sensitive && value.length) secrets.push(value);
			return;
		}
		if (Array.isArray(value)) {
			value.forEach(v => {
				visit(v, sensitive);
			});
			return;
		}
		if (value && typeof value === "object")
			for (const [key, child] of Object.entries(value))
				visit(child, sensitive || /(?:token|password|private_key|secret|credential)/i.test(key));
	};
	visit(payload);
	let text = raw;
	for (const secret of secrets.sort((a, b) => b.length - a.length)) {
		text = text.split(secret).join("[MASKED]");
		const escaped = JSON.stringify(secret).slice(1, -1);
		text = text.split(escaped).join("[MASKED]");
	}
	return text.replace(
		/-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/g,
		"[MASKED PRIVATE KEY]",
	);
}
function containsConfig(actual: unknown, expected: unknown): boolean {
	if (expected === null || typeof expected !== "object") return isDeepStrictEqual(actual, expected);
	if (Array.isArray(expected))
		return (
			Array.isArray(actual) &&
			actual.length === expected.length &&
			expected.every((value, index) => containsConfig(actual[index], value))
		);
	if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
	return Object.entries(expected).every(([key, value]) => containsConfig((actual as ObjectValue)[key], value));
}
async function writePrivate(file: string, value: unknown) {
	const temporary = `${file}.${randomUUID()}.tmp`;
	const handle = await fs.open(temporary, "wx", 0o600);
	try {
		await handle.writeFile(JSON.stringify(value));
		await handle.sync();
	} finally {
		await handle.close();
	}
	await fs.rename(temporary, file);
}
export async function checkImmutableMutation(
	options: Options,
): Promise<(AgentToolResult<XcshApiToolDetails> & { isError?: boolean }) | undefined> {
	const { contract, payload, resourcePath } = options;
	const namespace = decodeURIComponent(resourcePath.split("/").at(-3)!);
	const name = decodeURIComponent(resourcePath.split("/").at(-1)!);
	const scope = createHash("sha256")
		.update(JSON.stringify([options.apiBase, options.contextName ?? "", resourcePath]))
		.digest("hex");
	const root = options.stateDir ?? path.join(os.homedir(), ".xcsh", "state", "replacements");
	let stage: Stage | undefined;
	let locked = false;
	const requestId = randomUUID();
	const detail: XcshApiToolDetails = {
		status: 409,
		url: `${options.apiBase}${resourcePath}`,
		method: "PUT",
		requestId,
		contextName: options.contextName,
	};
	const result = (code: string, message: string, status = 409, extra: ObjectValue = {}) => ({
		content: [
			{
				type: "text" as const,
				text: JSON.stringify({
					code,
					message,
					replacementId: stage?.id,
					stage: stage?.stage,
					serviceState: stage?.serviceState,
					certificateState: stage?.certificateState,
					...extra,
				}),
			},
		],
		details: { ...detail, status, replacementId: stage?.id, replacementStage: stage?.stage },
		isError: true,
	});
	const save = async () => {
		if (stage) await writePrivate(path.join(root, `${stage.id}.json`), stage);
	};
	const read = async (method = "GET", body?: ObjectValue) => {
		if (!options.contextMatches())
			throw new ReplacementError(
				"context_mismatch",
				"The active API context changed; resume in the original context",
			);
		const timeout = AbortSignal.timeout(30_000);
		const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
		const response = await fetch(`${options.apiBase}${method === "POST" ? contract.collection : resourcePath}`, {
			method,
			headers: {
				...options.headers,
				"X-Request-ID": randomUUID(),
				...(body ? { "Content-Type": "application/json" } : {}),
			},
			signal,
			body: body ? JSON.stringify(body) : undefined,
		});
		const raw = await response.text();
		const safeRaw = maskSensitiveDiagnostic(raw, payload);
		let object: ObjectValue | undefined;
		try {
			object = objectValue(JSON.parse(raw));
		} catch {}
		return { status: response.status, ok: response.ok, object, raw: safeRaw };
	};
	const pause = async (attempt: number) => {
		options.signal?.throwIfAborted();
		await Bun.sleep(Math.min(250 * 2 ** attempt, 2000));
		options.signal?.throwIfAborted();
	};
	try {
		const meta = objectValue(payload.metadata);
		if (meta.name !== name || meta.namespace !== namespace)
			throw new ReplacementError("identity_mismatch", "Payload name and namespace must match the API path");
		const target = contract.groups.map(g => selectedMember(payload, g));
		if (options.replacementId && !/^[0-9a-f-]{36}$/.test(options.replacementId))
			throw new ReplacementError("invalid_replacement_id", "Invalid replacement ID");
		await fs.mkdir(root, { recursive: true, mode: 0o700 });
		try {
			await fs.mkdir(path.join(root, `${scope}.lock`), { mode: 0o700 });
			locked = true;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "EEXIST")
				return result("replacement_busy", "Another operation holds this object's replacement lock");
			throw err;
		}
		if (!options.replacementId) {
			for (const file of await fs.readdir(root)) {
				if (!file.endsWith(".json")) continue;
				const pending = JSON.parse(await fs.readFile(path.join(root, file), "utf8")) as Stage;
				if (pending.scope === scope && pending.stage !== "complete") {
					stage = pending;
					return result(
						"replacement_pending",
						"This object already has a pending cutover. Resume the replacement ID instead of starting another deletion.",
					);
				}
			}
		}
		if (options.replacementId) {
			stage = JSON.parse(await fs.readFile(path.join(root, `${options.replacementId}.json`), "utf8")) as Stage;
			if (
				stage.version !== 1 ||
				stage.id !== options.replacementId ||
				stage.scope !== scope ||
				stage.resourcePath !== resourcePath ||
				stage.name !== name ||
				stage.namespace !== namespace
			)
				throw new ReplacementError(
					"replacement_scope_mismatch",
					"Replacement ID does not match this context and object",
				);
			if (!isDeepStrictEqual(stage.targetSelections, target))
				throw new ReplacementError(
					"replacement_target_mismatch",
					"A resumed replacement must keep its original target type",
				);
		}
		const current = await read();
		if (!stage) {
			if (!current.ok || !current.object)
				throw new ReplacementError(
					"preflight_failed",
					`Cannot read the current object (${current.status}): ${current.raw}`,
					current.status,
				);
			const source = contract.groups.map(g => selectedMember(current.object!, g));
			if (isDeepStrictEqual(source, target)) return undefined;
			if (!options.recreate)
				return result(
					"replacement_required",
					"The immutable type selection changed. Explicit conversion requests use onImmutableSelectionChange: recreate. DELETE then POST causes downtime and may change UID or VIP.",
					409,
					{ currentSelections: source, targetSelections: target },
				);
			const old = identity(current.object, name, namespace);
			stage = {
				version: 1,
				id: randomUUID(),
				scope,
				resourcePath,
				name,
				namespace,
				originalUid: old.uid,
				originalVersion: old.version,
				originalSelections: source,
				targetSelections: target,
				stage: "prepared",
			};
		} else if (!options.recreate)
			return result("replacement_pending", "Resume requires onImmutableSelectionChange: recreate");
		// The body snapshot is private configuration, separate from the payload-free stage journal.
		// It never contains transport credentials and is never written to tool logs or details.
		if (stage.stage === "complete")
			return result("replacement_complete", "This replacement is already complete; use GET for its current state.");
		let base: ObjectValue;
		const bodyPath = path.join(root, `${stage.id}.body`);
		if (stage.stage === "prepared" && !options.replacementId) {
			const writable = current.object!.create_form ?? current.object!;
			base = objectValue(createBody(writable, contract.createSchema, contract.spec));
		} else {
			base = objectValue(JSON.parse(await fs.readFile(bodyPath, "utf8")));
		}

		await writePrivate(bodyPath, base);
		await save();
		const body = mergeObject(base, payload);
		for (const [i, g] of contract.groups.entries()) {
			const owner = valueAt(body, g.path);
			for (const member of g.members) delete owner[member];
			owner[target[i]!] = valueAt(payload, g.path)[target[i]!];
		}
		const projected = objectValue(createBody(body, contract.createSchema, contract.spec));
		const errors = validateBody(projected, contract.createSchema, contract.spec);
		const minimum = contract.createSchema["x-f5xc-minimum-configuration"] as
			| { required_fields?: string[] }
			| undefined;
		for (const field of minimum?.required_fields ?? []) {
			let value: unknown = projected;
			for (const part of field.split(".")) value = (value as ObjectValue)?.[part];
			if (value === undefined || value === null) errors.push(`${field}: required`);
		}
		if (errors.length)
			return result(
				"replacement_validation_failed",
				"Correct the create payload and resume the replacement. No DELETE was issued by this attempt.",
				422,
				{ errors },
			);
		contract.groups.forEach(g => {
			selectedMember(projected, g);
		});
		await writePrivate(bodyPath, projected);
		await save();
		if (stage.stage === "prepared" || stage.stage === "deleting") {
			if (current.status === 404 && stage.stage === "deleting") {
				stage.stage = "absent";
				await save();
			} else {
				if (!current.ok || !current.object)
					throw new ReplacementError("preflight_failed", "Existing object cannot be verified");
				const original = identity(current.object, name, namespace);
				if (
					original.uid !== stage.originalUid ||
					original.version !== stage.originalVersion ||
					!isDeepStrictEqual(
						contract.groups.map(g => selectedMember(current.object!, g)),
						stage.originalSelections,
					)
				)
					throw new ReplacementError("concurrent_change", "The original object changed; no DELETE was issued");
				// Save deletion intent before the final read. No asynchronous operation intervenes
				// between comparing this read and sending DELETE; the API still has no conditional DELETE.
				stage.stage = "deleting";
				await save();
				const latest = await read();
				if (
					!latest.ok ||
					!latest.object ||
					!isDeepStrictEqual(identity(latest.object, name, namespace), original) ||
					!isDeepStrictEqual(latest.object.spec, current.object.spec) ||
					!isDeepStrictEqual(latest.object.metadata, current.object.metadata)
				)
					throw new ReplacementError(
						"concurrent_change",
						"Object changed immediately before deletion; no DELETE was issued",
					);
				const deleted = await read("DELETE");
				if (!deleted.ok && deleted.status !== 404)
					throw new ReplacementError(
						"delete_failed",
						`DELETE failed (${deleted.status}): ${deleted.raw}`,
						deleted.status,
					);
				let absent = false;
				for (let attempt = 0; attempt < 6; attempt++) {
					const observed = await read();
					if (observed.status === 404) {
						absent = true;
						break;
					}
					if (!observed.ok)
						throw new ReplacementError(
							"absence_unverified",
							`Cannot verify deletion (${observed.status})`,
							observed.status,
						);
					if (observed.object && identity(observed.object, name, namespace).uid !== stage.originalUid)
						throw new ReplacementError("identity_mismatch", "Another object appeared while waiting for deletion");
					await pause(attempt);
				}
				if (!absent)
					return result(
						"replacement_pending",
						"Deletion has not reached absence. Keep diagnosing and resume this replacement ID.",
					);
				stage.stage = "absent";
				await save();
			}
		}

		for (let attempt = 0; attempt < 5; attempt++) {
			// Every uncertain create is followed by GET before any retry. Never delete a new object.
			const observed =
				stage.stage === "absent" && attempt === 0 && !options.replacementId
					? { status: 404, ok: false, object: undefined }
					: await read();
			if (observed.ok && observed.object) {
				const newIdentity = identity(observed.object, name, namespace);
				if (
					newIdentity.uid === stage.originalUid ||
					(stage.newUid && stage.newUid !== newIdentity.uid) ||
					!isDeepStrictEqual(
						contract.groups.map(g => selectedMember(observed.object!, g)),
						target,
					)
				)
					throw new ReplacementError(
						"replacement_identity_mismatch",
						"Readback is not the expected new object; no deletion or POST will be attempted",
					);
				const writable = objectValue(
					createBody(observed.object.create_form ?? observed.object, contract.createSchema, contract.spec),
				);
				if (!containsConfig(writable, projected))
					throw new ReplacementError(
						"replacement_configuration_mismatch",
						"The new object's configuration does not match the requested create body; continue diagnosis without deleting it",
					);
				stage.newUid = newIdentity.uid;
				stage.stage = "verifying";
				await save();
				const service = objectValue(observed.object.spec).state;
				stage.serviceState = typeof service === "string" ? service : undefined;
				const automatic = target.includes("https_auto_cert");
				const certificateState = (objectValue(observed.object.spec).auto_cert_info as ObjectValue | undefined)
					?.auto_cert_state;
				stage.certificateState = typeof certificateState === "string" ? certificateState : undefined;
				await save();
				if (
					typeof service !== "string" ||
					!/^(?:VIRTUAL_HOST_READY|READY|ACTIVE|RUNNING)$/i.test(service) ||
					(automatic &&
						certificateState !== undefined &&
						!/^(?:CertificateIssued|AutoCertIssued|CertificateValid)$/i.test(String(certificateState)))
				) {
					await pause(attempt);
					continue;
				}
				stage.stage = "complete";
				await save();
				await fs.rm(bodyPath, { force: true });
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								code: "replacement_complete",
								message: `Recreated ${name} in ${namespace}. Verified target type, new UID, and service state. The cutover caused downtime and may have changed the VIP.`,
								replacementId: stage.id,
								originalUid: stage.originalUid,
								newUid: stage.newUid,
								targetSelections: target,
								serviceState: service,
							}),
						},
					],
					details: {
						...detail,
						status: 200,
						method: "POST",
						replacementId: stage.id,
						replacementStage: stage.stage,
						mutationVerb: "Created",
						resourceLabel: `load balancer ${name}`,
					},
				};
			}
			if (observed.status !== 404) {
				await pause(attempt);
				continue;
			}
			if (stage.stage === "verifying")
				return result(
					"replacement_pending",
					"The new object disappeared during verification. Diagnose before retrying.",
				);
			stage.stage = "creating";
			await save();
			let created: Awaited<ReturnType<typeof read>>;
			try {
				created = await read("POST", projected);
			} catch {
				await pause(attempt);
				continue;
			}
			if (created.ok && typeof (created.object?.system_metadata as ObjectValue)?.uid === "string") {
				stage.newUid = (created.object!.system_metadata as ObjectValue).uid as string;
				await save();
			}
			const validationFailure =
				/(?:should be valid|should (?:be|have)|must be|required|invalid|does not exist|validation)/i.test(
					created.raw,
				);
			if (!created.ok && (validationFailure || ![408, 409, 429, 500, 502, 503, 504].includes(created.status)))
				return result(
					"replacement_create_failed",
					`POST failed (${created.status}): ${created.raw}. The original LB remains deleted. Correct the payload and resume this replacement ID; do not DELETE again.`,
					created.status,
				);
			await pause(attempt);
		}
		return result(
			"replacement_pending",
			"The cutover is incomplete. Continue diagnosis and resume this replacement ID; the original LB is not restored.",
		);
	} catch (err) {
		if (err instanceof ReplacementError) return result(err.code, err.message, err.status);
		// Transport exceptions may contain private request data. Stage/HTTP diagnostics carry
		// the actionable context without echoing arbitrary exception strings.
		return result(
			"replacement_pending",
			"The immutable mutation could not finish. Inspect the object state and resume the private replacement stage. No success is claimed.",
			503,
		);
	} finally {
		if (locked) await fs.rmdir(path.join(root, `${scope}.lock`));
	}
}
