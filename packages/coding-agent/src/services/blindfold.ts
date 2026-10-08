import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	type BlindfoldInput,
	type BlindfoldPrepared,
	blindfoldEncryptInput,
	blindfoldPrepare,
} from "@f5-sales-demo/pi-natives";
import type { HttpTransport, ResourceManifest } from "@f5-sales-demo/pi-resource-management";

import {
	canonicalBlindfoldDocument,
	normalizeBlindfoldDocument,
	readBlindfoldDocument,
	readBlindfoldResponse,
	serializeBlindfoldDocument,
} from "./blindfold-documents";

export const BLINDFOLD_OPERATIONS = ["public-key", "policy", "encrypt", "certificate", "create", "replace"] as const;
export type BlindfoldOperation = (typeof BLINDFOLD_OPERATIONS)[number];
export interface BlindfoldArgs {
	operation: BlindfoldOperation;
	compatibility?: boolean;
	encoding?: "base64" | "location";
	outfile?: string;
	keyVersion?: number;
	input?: string;
	publicKey?: string;
	policyDocument?: string;
	output?: "json" | "yaml";
	cert?: string;
	key?: string;
	bundle?: string;
	passphraseEnv?: string;
	name?: string;
	namespace?: string;
	policy?: string;
	contextName?: string;
	outputFile?: string;
	resultFile?: string;
	dryRun?: "client";
}
export interface BlindfoldReport {
	status: "material-retrieved" | "prepared" | "dry-run" | "accepted";
	operation: BlindfoldOperation;
	materialSource?: "retrieved" | "supplied";
	target: { apiUrl?: string; tenant: string; namespace?: string; name?: string; contextName?: string };
	fingerprint?: string;
	expiresAt?: string;
	algorithm?: string;
	artifacts: string[];
	readiness?: "unverified";
	reconciled?: boolean;
}
export interface BlindfoldRuntime {
	signal?: AbortSignal;
	planMode?: boolean;
	guard?: () => void;
}
interface Options {
	emit?: (content: string) => void;
	env: Readonly<Record<string, string | undefined>>;
	cwd?: string;
	fetch?: (url: string, init?: RequestInit) => Promise<Response>;
	prepare?: (input: BlindfoldInput) => BlindfoldPrepared;
	prepareInput?: (input: BlindfoldInput, signal?: AbortSignal) => Promise<BlindfoldPrepared>;
}
const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const identity = (v: string | undefined, what: string) => {
	if (!v || !label.test(v)) throw new Error(`Invalid ${what}`);
	return v;
};
function tenantOf(url: string): string {
	const parsed = new URL(url);
	if (
		parsed.protocol !== "https:" ||
		parsed.username ||
		parsed.password ||
		parsed.search ||
		parsed.hash ||
		parsed.pathname !== "/"
	)
		throw new Error("Tenant API URL must be an HTTPS origin");
	return parsed.hostname.split(".")[0]!;
}
/** Exclusive atomic publication avoids following or overwriting an existing artifact/symlink. */
export async function writeBlindfoldArtifact(
	destination: string,
	content: string | Uint8Array,
	guard: () => void,
): Promise<void> {
	const temp = path.join(path.dirname(destination), `.blindfold-${crypto.randomUUID()}.tmp`);
	let handle: fs.FileHandle | undefined;
	try {
		guard();
		handle = await fs.open(temp, "wx", 0o600);
		await handle.writeFile(content, "utf8");
		await handle.sync();
		await handle.close();
		handle = undefined;
		guard();
		await fs.link(temp, destination);
	} catch {
		throw new Error("Cannot publish Blindfold artifact; destination must be new and its directory writable");
	} finally {
		await handle?.close();
		await fs.unlink(temp).catch(() => {});
	}
}
/** Holds encrypted material locally; callers receive only the public report. */
export class BlindfoldService {
	readonly #options: Options;
	constructor(options: Options) {
		this.#options = options;
	}
	async run(args: BlindfoldArgs, runtime: BlindfoldRuntime = {}): Promise<BlindfoldReport> {
		const guard = () => {
			if (runtime.signal?.aborted) throw new Error("Blindfold operation cancelled");
			runtime.guard?.();
		};
		guard();
		if (!BLINDFOLD_OPERATIONS.includes(args.operation)) throw new Error("Invalid Blindfold operation");
		if (
			runtime.planMode &&
			(args.outputFile || args.outfile || args.resultFile || ["create", "replace"].includes(args.operation))
		)
			throw new Error("Plan mode: Blindfold deployments and artifact writes are blocked");
		if (
			args.keyVersion !== undefined &&
			(args.operation !== "public-key" ||
				!Number.isInteger(args.keyVersion) ||
				args.keyVersion < 0 ||
				args.keyVersion > 0xffffffff)
		)
			throw new Error("Key version must be an unsigned 32-bit integer for public key retrieval");
		if (args.encoding && (args.operation !== "encrypt" || !["base64", "location"].includes(args.encoding)))
			throw new Error("Invalid encryption encoding");
		if (args.outfile && (!args.compatibility || args.operation !== "encrypt" || args.outputFile || args.encoding))
			throw new Error("Binary outfile conflicts with textual output or operation");
		if (args.compatibility && args.operation === "policy" && !args.name)
			throw new Error("Compatibility policy retrieval requires name");
		const offline = Boolean(args.publicKey && args.policyDocument);
		if (Boolean(args.publicKey) !== Boolean(args.policyDocument))
			throw new Error("Public key and policy document files must be supplied together");
		if ((args.publicKey || args.policyDocument) && args.operation !== "encrypt")
			throw new Error("Supplied public material is supported only for encrypt");
		if (offline && args.contextName) throw new Error("Offline encryption does not select a context");
		if (args.output && !["public-key", "policy"].includes(args.operation))
			throw new Error("Output format applies only to public material retrieval");
		if (args.output && !["json", "yaml"].includes(args.output))
			throw new Error("Invalid public material output format");
		if (args.operation === "policy" && args.policy && (args.namespace !== undefined || args.name !== undefined))
			throw new Error("Cannot combine policy with explicit namespace/name");
		if (args.operation === "public-key" && (args.namespace || args.policy))
			throw new Error("Public key retrieval does not select a policy namespace");
		const resolve = (v: string | undefined) => (v ? path.resolve(this.#options.cwd ?? process.cwd(), v) : undefined);
		if (
			(args.outputFile || args.outfile) &&
			args.resultFile &&
			resolve(args.outputFile ?? args.outfile) === resolve(args.resultFile)
		)
			throw new Error("Artifact and report destinations must differ");
		const env = offline ? {} : this.#options.env;
		const apiUrl = env.XCSH_API_URL?.replace(/\/+$/, "");
		const token = env.XCSH_API_TOKEN;
		if (!offline && (!apiUrl || !token)) throw new Error("Blindfold requires tenant API credentials");
		const tenant = offline ? "" : tenantOf(apiUrl!);
		if (args.contextName && args.contextName !== env.XCSH_CONTEXT_NAME) throw new Error("Blindfold context mismatch");
		const fetcher = this.#options.fetch ?? ((url, init) => fetch(url, init));
		const target: BlindfoldReport["target"] = { apiUrl, tenant, contextName: env.XCSH_CONTEXT_NAME };

		const request = async (method: string, url: string, body?: Record<string, unknown>) => {
			guard();
			try {
				const signal = runtime.signal
					? AbortSignal.any([runtime.signal, AbortSignal.timeout(30_000)])
					: AbortSignal.timeout(30_000);
				const response = await fetcher(url, {
					method,
					signal,
					redirect: "error",
					headers: {
						Authorization: `APIToken ${token}`,
						Accept: "application/json",
						"Content-Type": "application/json",
					},
					body: body ? JSON.stringify(body) : undefined,
				});
				const parsed = response.ok ? await readBlindfoldResponse(response) : {};
				guard();
				return { httpStatus: response.status, body: parsed as Record<string, unknown> };
			} catch {
				guard();
				throw new Error("Blindfold network request failed");
			}
		};
		const get = async (url: string) => {
			const value = await request("GET", url);
			if (value.httpStatus < 200 || value.httpStatus >= 300)
				throw new Error(`Blindfold public material request failed (HTTP ${value.httpStatus})`);
			return value.body;
		};
		const policyParts = (
			args.operation === "policy"
				? (args.policy ??
					`${args.namespace ?? (args.compatibility ? "default" : "shared")}/${args.name ?? "ves-io-allow-volterra"}`)
				: (args.policy ?? "shared/ves-io-allow-volterra")
		).split("/");
		if (policyParts.length !== 2) throw new Error("Policy must be namespace/name");
		const policyNamespace = identity(policyParts[0], "policy namespace"),
			policyName = identity(policyParts[1], "policy name");
		const publicUrl = `${apiUrl}/api/secret_management/get_public_key${args.keyVersion ? `?key_version=${args.keyVersion}` : ""}`;
		const policyUrl = `${apiUrl}/api/secret_management/namespaces/${policyNamespace}/secret_policys/${policyName}/get_policy_document`;
		let artifact: string | Uint8Array | undefined;
		let report: BlindfoldReport;
		if (args.operation === "public-key" || args.operation === "policy") {
			if (
				args.input ||
				args.cert ||
				args.key ||
				args.bundle ||
				(args.operation !== "policy" && args.name) ||
				args.dryRun ||
				args.passphraseEnv
			)
				throw new Error("Public material operations do not accept certificate or deployment inputs");
			const material = canonicalBlindfoldDocument(
				await get(args.operation === "public-key" ? publicUrl : policyUrl),
				args.operation,
			) as { data: Record<string, unknown> };
			if (args.keyVersion && material.data.key_version !== args.keyVersion)
				throw new Error("Blindfold public key version mismatch");
			const canonicalTenant = (material.data as Record<string, unknown> | undefined)?.tenant;
			if (typeof canonicalTenant !== "string" || !label.test(canonicalTenant))
				throw new Error("Malformed Blindfold tenant identity");
			target.tenant = canonicalTenant;
			artifact = serializeBlindfoldDocument(
				material,
				args.output ?? (args.compatibility ? "yaml" : "json"),
				args.compatibility,
			);
			report = {
				status: "material-retrieved",
				materialSource: "retrieved",
				operation: args.operation,
				target,
				artifacts: [],
			};
		} else {
			if (args.operation === "encrypt") {
				if (!args.input || args.cert || args.key || args.bundle || args.name || args.passphraseEnv || args.dryRun)
					throw new Error("Encrypt requires only an input filename or stdin");
			} else {
				if (args.input || (args.bundle ? args.cert || args.key : !args.cert || !args.key))
					throw new Error("Use either --bundle FILE or --cert FILE and --key FILE");
				target.name = identity(args.name, "certificate name");
				target.namespace = identity(args.namespace ?? env.XCSH_NAMESPACE, "certificate namespace");
			}
			const publicKey = offline
				? await readBlindfoldDocument(resolve(args.publicKey)!, "public-key")
				: normalizeBlindfoldDocument(await get(publicUrl), "public-key");
			guard();
			const policy = offline
				? await readBlindfoldDocument(resolve(args.policyDocument)!, "policy")
				: normalizeBlindfoldDocument(await get(policyUrl), "policy");
			const canonicalTenant = (publicKey.data as Record<string, unknown> | undefined)?.tenant;
			if (
				typeof canonicalTenant !== "string" ||
				!label.test(canonicalTenant) ||
				(policy.data as Record<string, unknown> | undefined)?.tenant !== canonicalTenant
			)
				throw new Error("Blindfold material tenant mismatch");
			target.tenant = canonicalTenant;
			guard();
			let prepared: BlindfoldPrepared;
			try {
				const nativeInput = {
					publicKeyJson: JSON.stringify(publicKey),
					policyJson: JSON.stringify(policy),
					input: args.input === "-" ? "-" : resolve(args.input),
					cert: resolve(args.cert),
					key: resolve(args.key),
					bundle: resolve(args.bundle),
					passphraseEnv: args.passphraseEnv,
				};
				prepared =
					args.operation === "encrypt" && !this.#options.prepare
						? await (this.#options.prepareInput ?? blindfoldEncryptInput)(nativeInput, runtime.signal)
						: (this.#options.prepare ?? blindfoldPrepare)(nativeInput);
			} catch (error) {
				guard();
				throw error;
			}
			guard();
			report = {
				status: args.dryRun ? "dry-run" : "prepared",
				operation: args.operation,
				materialSource: offline ? "supplied" : "retrieved",
				target,
				fingerprint: prepared.fingerprint,
				expiresAt: prepared.expiresAt,
				algorithm: prepared.algorithm,
				artifacts: [],
			};
			if (args.operation === "encrypt") {
				const base64 = prepared.location.slice("string:///".length);
				artifact = args.outfile
					? Buffer.from(base64, "base64")
					: `${(args.encoding ?? (args.compatibility ? "base64" : "location")) === "base64" ? base64 : prepared.location}\n`;
			} else {
				const { ResourceClient, validateManifest } = await import("@f5-sales-demo/pi-resource-management");
				const { kindResolver } = await import("../resource-management/index");
				const spec: Record<string, unknown> = {
					certificate_url: prepared.certificateUrl,
					private_key: { blindfold_secret_info: { location: prepared.location } },
				};
				let metadata: Record<string, unknown> = { name: target.name, namespace: target.namespace };
				const resolved = kindResolver.resolveKind("certificate");
				// One transport attempt for writes: ResourceClient never sees an echoed server error or retries a mutation.
				const transport: HttpTransport = {
					request: async req => {
						try {
							const url = new URL(req.url);
							if (req.method === "GET" && /\/certificates\/[^/]+$/.test(url.pathname))
								url.searchParams.set("response_format", "2");
							const r = await request(req.method, url.toString(), req.body);
							const body = (r.body.replace_form ?? r.body) as Record<string, unknown>;
							return {
								httpStatus: r.httpStatus,
								body:
									r.httpStatus >= 200 && r.httpStatus < 300
										? body
										: { message: `Blindfold tenant request failed (HTTP ${r.httpStatus})` },
							};
						} catch {
							guard();
							return { httpStatus: 0, body: { message: "Blindfold tenant request outcome is uncertain" } };
						}
					},
				};
				const client = new ResourceClient({
					apiUrl: apiUrl!,
					apiToken: token!,
					namespace: target.namespace!,
					transport,
				});
				if (args.operation === "create" || args.operation === "replace") {
					const existing = await client.get(resolved, target.name, target.namespace);
					guard();
					if (existing.error && existing.error.kind !== "not_found")
						throw new Error("Cannot inspect certificate before deployment");
					if (args.operation === "create" && existing.resource)
						throw new Error("Certificate already exists; use explicit replace to rotate");
					if (args.operation === "replace" && !existing.resource)
						throw new Error("Certificate does not exist; use create");
					if (existing.resource) {
						const oldMeta = (existing.resource.metadata ?? {}) as Record<string, unknown>;
						metadata = { ...oldMeta, name: target.name, namespace: target.namespace };
						const oldSpec = (existing.resource.spec ?? {}) as Record<string, unknown>;
						Object.assign(spec, {
							...oldSpec,
							certificate_url: prepared.certificateUrl,
							private_key: { blindfold_secret_info: { location: prepared.location } },
						});
					}
				}
				const rawObject = { kind: "certificate", metadata, spec };
				const manifest: ResourceManifest = {
					kind: "certificate",
					metadata: { name: target.name!, namespace: target.namespace },
					spec,
					rawObject,
				};
				const validation = validateManifest(manifest, kindResolver, target.namespace, {
					operation: args.operation === "replace" ? "update" : "create",
				});
				if (!validation.result.valid) throw new Error("Blindfold certificate manifest failed validation");
				artifact = `${JSON.stringify(rawObject, null, 2)}\n`;
				if ((args.operation === "create" || args.operation === "replace") && !args.dryRun) {
					guard();
					const result =
						args.operation === "create"
							? await client.create(manifest, resolved, target.namespace)
							: await client.update(manifest, resolved, target.namespace);
					// Re-read after both accepted and uncertain outcomes; never automatically retry a write.
					const verify = await client.get(resolved, target.name, target.namespace);
					const current = (verify.resource?.spec ?? {}) as Record<string, unknown>;
					const privateKey = current.private_key as { blindfold_secret_info?: { location?: string } } | undefined;
					if (
						current.certificate_url !== prepared.certificateUrl ||
						privateKey?.blindfold_secret_info?.location !== prepared.location
					)
						throw new Error(
							`Certificate write outcome unresolved${result.status === "error" ? ` (HTTP ${result.error?.httpStatus ?? 0})` : ""}; inspect named certificate before retrying`,
						);
					report.status = "accepted";
					report.readiness = "unverified";
					report.reconciled = result.status === "error";
				}
			}
		}
		if (args.outputFile || args.outfile) {
			const destination = path.resolve(this.#options.cwd ?? process.cwd(), (args.outputFile ?? args.outfile)!);
			await writeBlindfoldArtifact(destination, artifact!, guard);
			report.artifacts.push(destination);
		}
		if (args.resultFile) {
			const destination = path.resolve(this.#options.cwd ?? process.cwd(), args.resultFile);
			report.artifacts.push(destination);
			await writeBlindfoldArtifact(destination, `${JSON.stringify(report, null, 2)}\n`, guard);
		}
		if (
			typeof artifact === "string" &&
			!args.outputFile &&
			!args.outfile &&
			!["create", "replace"].includes(args.operation)
		)
			this.#options.emit?.(artifact);
		return report;
	}
}
