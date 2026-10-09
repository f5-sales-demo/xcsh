import { createHash, X509Certificate } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { blindfoldPrepare } from "@f5-sales-demo/pi-natives";
import type { HttpTransport, ResourceManifest } from "@f5-sales-demo/pi-resource-management";
import { API_CATALOG_DATA } from "../internal-urls/api-catalog-index.generated";
import type { BlindfoldArgs, BlindfoldOptions, BlindfoldReport, BlindfoldRuntime } from "./blindfold";
import contractBundle from "./blindfold-contract/blindfold-contract-v1.txt" with { type: "text" };
import contractLock from "./blindfold-contract/lock.json" with { type: "json" };
import {
	canonicalBlindfoldDocument,
	normalizeBlindfoldDocument,
	parseBlindfoldDocument,
	readBlindfoldResponse,
} from "./blindfold-documents";

const annotation = "f5-sales-demo.com/blindfold";
const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const hash = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
function canonical(v: unknown): unknown {
	return Array.isArray(v)
		? v.map(canonical)
		: object(v)
			? Object.fromEntries(
					Object.keys(v)
						.sort()
						.map(k => [k, canonical(v[k])]),
				)
			: v;
}
interface Entry {
	chain: string;
	spki: string;
	context: string;
	ciphertext: string;
	algorithm: string;
}
interface Source {
	id: string;
	pointer: string;
	certificate_file?: string;
	private_key_file?: string;
	pkcs12_file?: string;
	passphrase_env?: string;
	policy?: string;
}
function pointer(root: Record<string, unknown>, text: string): Record<string, unknown> {
	if (!text.startsWith("/spec") || /~(?![01])/.test(text))
		throw new Error("Blindfold pointer must target a recognized certificate node beneath /spec");
	let value: unknown = root;
	for (const token of text
		.slice(1)
		.split("/")
		.map(v => v.replaceAll("~1", "/").replaceAll("~0", "~"))) {
		if (Array.isArray(value)) {
			if (!/^(0|[1-9][0-9]*)$/.test(token)) throw new Error("Invalid Blindfold array pointer");
			value = value[Number(token)];
		} else if (object(value) && Object.hasOwn(value, token)) value = value[token];
		else throw new Error("Unresolved Blindfold certificate pointer");
	}
	if (!object(value)) throw new Error("Blindfold pointer must target a certificate object");
	return value;
}
function identity(certificateUrl: string) {
	if (!certificateUrl.startsWith("string:///")) throw new Error("Native certificate normalization failed");
	const chain = Buffer.from(certificateUrl.slice(10), "base64");
	const leaf = new X509Certificate(chain);
	return { chain: hash(chain), spki: hash(leaf.publicKey.export({ format: "der", type: "spki" })) };
}
function provenance(remote: Record<string, unknown> | undefined): Record<string, Entry> {
	const metadata = remote?.metadata;
	const annotations = object(metadata) ? metadata.annotations : undefined;
	const text = object(annotations) ? annotations[annotation] : undefined;
	if (typeof text !== "string" || text.length > 131072) return {};
	try {
		const parsed = parseBlindfoldDocument(text);
		if (!object(parsed) || parsed.version !== 1 || !object(parsed.entries)) return {};
		for (const [id, entry] of Object.entries(parsed.entries)) {
			if (
				!label.test(id) ||
				!object(entry) ||
				!["RSA", "EC"].includes(String(entry.algorithm)) ||
				[entry.chain, entry.spki, entry.context, entry.ciphertext].some(
					v => typeof v !== "string" || !/^[0-9a-f]{64}$/.test(v),
				)
			)
				return {};
		}
		return parsed.entries as Record<string, Entry>;
	} catch {
		return {};
	}
}

export async function ensureBlindfold(
	options: BlindfoldOptions,
	args: BlindfoldArgs,
	runtime: BlindfoldRuntime,
): Promise<BlindfoldReport> {
	const guard = () => {
		if (runtime.signal?.aborted) throw new Error("Blindfold operation cancelled");
		runtime.guard?.();
	};
	guard();
	if (hash(contractBundle) !== contractLock.sha256 || contractLock.version !== 1)
		throw new Error("Embedded Blindfold contract integrity failure");
	if (runtime.planMode) throw new Error("Plan mode: Blindfold ensure is blocked");
	const apiUrl = options.env.XCSH_API_URL?.replace(/\/+$/, ""),
		token = options.env.XCSH_API_TOKEN;
	if (!apiUrl || !token) throw new Error("Blindfold requires tenant API credentials");
	const origin = new URL(apiUrl);
	if (
		origin.protocol !== "https:" ||
		origin.username ||
		origin.password ||
		origin.search ||
		origin.hash ||
		origin.pathname !== "/"
	)
		throw new Error("Tenant API URL must be an HTTPS origin");
	if (args.contextName && args.contextName !== options.env.XCSH_CONTEXT_NAME)
		throw new Error("Blindfold context mismatch");
	const fetcher = options.fetch ?? fetch;
	const request = async (method: string, url: string, body?: Record<string, unknown>) => {
		guard();
		const signal = runtime.signal
			? AbortSignal.any([runtime.signal, AbortSignal.timeout(30000)])
			: AbortSignal.timeout(30000);
		try {
			const r = await fetcher(url, {
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
			const parsed = r.ok ? await readBlindfoldResponse(r) : {};
			guard();
			return { status: r.status, body: object(parsed) ? parsed : {} };
		} catch {
			guard();
			return { status: 0, body: {} };
		}
	};
	const get = async (url: string) => {
		const r = await request("GET", url);
		if (r.status !== 200) throw new Error("Cannot retrieve Blindfold public material");
		return r.body;
	};
	let raw: Record<string, unknown>,
		sources: Source[],
		base = options.cwd ?? process.cwd();
	if (args.file) {
		if (args.cert || args.key || args.bundle || args.name || args.passphraseEnv || args.policy)
			throw new Error("Manifest ensure conflicts with named certificate inputs");
		const filename = path.resolve(base, args.file);
		const stat = await fs.stat(filename);
		if (!stat.isFile() || stat.size > 2097152) throw new Error("Blindfold manifest exceeds input bounds");
		const parsed = parseBlindfoldDocument(await fs.readFile(filename, "utf8"));
		if (!object(parsed) || !object(parsed.metadata) || !object(parsed.spec))
			throw new Error("Malformed Blindfold manifest");
		raw = parsed;
		const extension = raw["x-xcsh-blindfold"];
		if (
			!object(extension) ||
			extension.version !== 1 ||
			!Array.isArray(extension.certificates) ||
			!extension.certificates.length
		)
			throw new Error("Require x-xcsh-blindfold version 1 certificates");
		sources = extension.certificates as Source[];
		delete raw["x-xcsh-blindfold"];
		base = path.dirname(filename);
	} else {
		if (!args.name || !label.test(args.name) || (args.bundle ? args.cert || args.key : !args.cert || !args.key))
			throw new Error("Ensure requires name and PEM files or a P12 bundle");
		raw = {
			kind: "certificate",
			metadata: { name: args.name, namespace: args.namespace ?? options.env.XCSH_NAMESPACE },
			spec: {},
		};
		sources = [
			{
				id: "default",
				pointer: "/spec",
				certificate_file: args.cert,
				private_key_file: args.key,
				pkcs12_file: args.bundle,
				passphrase_env: args.passphraseEnv,
				policy: args.policy,
			},
		];
	}
	const metadata = raw.metadata as Record<string, unknown>,
		kind = raw.kind;
	const name = metadata.name,
		namespace = args.namespace ?? metadata.namespace ?? options.env.XCSH_NAMESPACE;
	if (
		typeof kind !== "string" ||
		typeof name !== "string" ||
		!label.test(name) ||
		typeof namespace !== "string" ||
		!label.test(namespace)
	)
		throw new Error("Invalid manifest resource identity");
	metadata.namespace = namespace;
	const { kindResolver } = await import("../resource-management/index");
	const { ResourceClient, validateManifest } = await import("@f5-sales-demo/pi-resource-management");
	const resolved = kindResolver.resolveKind(kind);
	const transport: HttpTransport = {
		request: async req => {
			const url = new URL(req.url);
			if (req.method === "GET") url.searchParams.set("response_format", "2");
			const r = await request(req.method, url.toString(), req.body);
			const form = r.body.replace_form;
			const body = object(form)
				? { ...form, ...(r.body.resource_version ? { resource_version: r.body.resource_version } : {}) }
				: r.body;
			return {
				httpStatus: r.status,
				body:
					r.status >= 200 && r.status < 300
						? body
						: { message: `Blindfold tenant request failed (HTTP ${r.status})` },
			};
		},
	};
	const client = new ResourceClient({ apiUrl, apiToken: token, namespace, transport });
	const existing = await client.get(resolved, name, namespace);
	guard();
	if (existing.error && existing.error.kind !== "not_found")
		throw new Error("Cannot inspect resource before Blindfold ensure");
	const remote = existing.resource as Record<string, unknown> | undefined;
	if (!args.file && remote)
		raw = {
			kind,
			...remote,
			metadata: { ...(remote.metadata as Record<string, unknown>), name, namespace },
			spec: { ...(remote.spec as Record<string, unknown>) },
		};
	const publicDocument = canonicalBlindfoldDocument(
		await get(`${apiUrl}/api/secret_management/get_public_key`),
		"public-key",
	);
	const pub = normalizeBlindfoldDocument(publicDocument, "public-key");
	const entries = provenance(remote),
		ids = new Set<string>(),
		pointers = new Set<string>();
	let changed = !remote;
	const policies = new Map<string, unknown>();
	for (const source of sources) {
		guard();
		if (
			!object(source) ||
			!label.test(source.id) ||
			typeof source.pointer !== "string" ||
			ids.has(source.id) ||
			pointers.has(source.pointer)
		)
			throw new Error("Blindfold IDs and pointers must be unique");
		ids.add(source.id);
		pointers.add(source.pointer);
		const node = pointer(raw, source.pointer);
		// Resolve a concrete JSON pointer against embedded operation field metadata.
		const fieldPath = source.pointer
			.slice(1)
			.replace(/\/(0|[1-9][0-9]*)(?=\/|$)/g, "[]")
			.replaceAll("/", ".");
		const recognized = Object.values(API_CATALOG_DATA).some(category =>
			category.operations.some(
				operation =>
					operation.method.toLowerCase() === "post" &&
					operation.path
						.replaceAll("{metadata.namespace}", "{namespace}")
						.replaceAll("{metadata.name}", "{name}") === resolved.paths.create &&
					Object.hasOwn(operation.fieldMetadata ?? {}, `${fieldPath}.certificate_url`) &&
					Object.keys(operation.fieldMetadata ?? {}).some(field => field.startsWith(`${fieldPath}.private_key.`)),
			),
		);
		if (!recognized && !(source.pointer === "/spec" && resolved.kind === "certificate"))
			throw new Error("Unsupported Blindfold certificate node");
		if (
			source.pkcs12_file
				? source.certificate_file || source.private_key_file
				: !source.certificate_file || !source.private_key_file
		)
			throw new Error("Require PEM pair or one P12 file");
		const policyName = source.policy ?? "shared/ves-io-allow-volterra";
		const parts = policyName.split("/");
		if (parts.length !== 2 || parts.some(v => !label.test(v))) throw new Error("Invalid Blindfold policy");
		let policyDocument = policies.get(policyName);
		if (!policyDocument) {
			policyDocument = canonicalBlindfoldDocument(
				await get(
					`${apiUrl}/api/secret_management/namespaces/${parts[0]}/secret_policys/${parts[1]}/get_policy_document`,
				),
				"policy",
			);
			policies.set(policyName, policyDocument);
		}
		const policy = normalizeBlindfoldDocument(policyDocument, "policy");
		if (policy.data.tenant !== pub.data.tenant) throw new Error("Blindfold material tenant mismatch");
		const context = hash(JSON.stringify(canonical([publicDocument, policyDocument])));
		const input = {
			publicKeyJson: JSON.stringify(pub),
			policyJson: JSON.stringify(policy),
			cert: source.certificate_file ? path.resolve(base, source.certificate_file) : undefined,
			key: source.private_key_file ? path.resolve(base, source.private_key_file) : undefined,
			bundle: source.pkcs12_file ? path.resolve(base, source.pkcs12_file) : undefined,
			passphraseEnv: source.passphrase_env,
		};
		const inspect = (options.prepare ?? blindfoldPrepare)({ ...input, inspectOnly: true });
		guard();
		if (!inspect.certificateUrl || !inspect.algorithm) throw new Error("Native certificate inspection failed");
		const publicIdentity = identity(inspect.certificateUrl),
			old = entries[source.id];
		let oldNode: Record<string, unknown> = {};
		try {
			if (remote) oldNode = nodeByEntry(remote, old) ?? pointer(remote, source.pointer);
		} catch {}
		const privateKey = oldNode.private_key,
			blind = object(privateKey) ? privateKey.blindfold_secret_info : undefined,
			location = object(blind) ? blind.location : undefined;
		if (old?.algorithm && old.algorithm !== inspect.algorithm)
			throw new Error("RSA/EC algorithm changes require a new certificate and reference cutover");
		const equivalent =
			typeof location === "string" &&
			oldNode.certificate_url === inspect.certificateUrl &&
			old?.chain === publicIdentity.chain &&
			old.spki === publicIdentity.spki &&
			old.context === context &&
			old.ciphertext === hash(location) &&
			old.algorithm === inspect.algorithm;
		let encrypted = equivalent ? location : "";
		if (!equivalent) {
			changed = true;
			if (!args.dryRun) encrypted = (options.prepare ?? blindfoldPrepare)(input).location;
		}
		node.certificate_url = inspect.certificateUrl;
		node.private_key = { blindfold_secret_info: { location: encrypted } };
		entries[source.id] = { ...publicIdentity, context, ciphertext: hash(encrypted), algorithm: inspect.algorithm };
	}
	const oldMeta = remote?.metadata;
	const oldAnnotations = object(oldMeta) && object(oldMeta.annotations) ? oldMeta.annotations : {};
	const desiredMeta = raw.metadata as Record<string, unknown>;
	desiredMeta.annotations = {
		...oldAnnotations,
		...(object(desiredMeta.annotations) ? desiredMeta.annotations : {}),
		[annotation]: JSON.stringify({ version: 1, entries }),
	};
	if (remote?.resource_version) raw.resource_version = remote.resource_version;
	const report: BlindfoldReport = {
		operation: "ensure",
		status: args.dryRun ? "dry-run" : "unchanged",
		target: { apiUrl, tenant: String(pub.data.tenant), namespace, name },
		artifacts: [],
	};
	if (!changed && !args.file) return report;
	const manifest: ResourceManifest = {
		kind,
		metadata: { name, namespace },
		spec: raw.spec as Record<string, unknown>,
		rawObject: raw,
	};
	if (
		!args.dryRun &&
		!validateManifest(manifest, kindResolver, namespace, { operation: remote ? "update" : "create" }).result.valid
	)
		throw new Error("Blindfold manifest failed validation");
	if (args.dryRun) return report;
	guard();
	const result = remote
		? await client.update(manifest, resolved, namespace)
		: await client.create(manifest, resolved, namespace);
	if (result.status === "error" && result.error?.httpStatus === 409)
		throw new Error("Blindfold concurrency conflict; refresh and review before retrying");
	const verify = await client.get(resolved, name, namespace);
	guard();
	if (!verify.resource) throw new Error("Blindfold write outcome unresolved; inspect resource before retrying");
	for (const source of sources) {
		const expected = pointer(raw, source.pointer),
			actual = pointer(verify.resource, source.pointer);
		if (
			expected.certificate_url !== actual.certificate_url ||
			remoteEncryptedLocation(expected) !== remoteEncryptedLocation(actual)
		)
			throw new Error("Blindfold write outcome unresolved; inspect resource before retrying");
	}
	if (JSON.stringify(canonical(provenance(verify.resource))) !== JSON.stringify(canonical(entries)))
		throw new Error("Blindfold provenance readback failed");
	report.status = result.status === "unchanged" ? "unchanged" : "accepted";
	report.readiness = "unverified";
	report.reconciled = result.status === "error";
	return report;
}

function remoteEncryptedLocation(node: Record<string, unknown>): unknown {
	const key = node.private_key;
	const encrypted = object(key) ? key.blindfold_secret_info : undefined;
	return object(encrypted) ? encrypted.location : undefined;
}

function nodeByEntry(remote: Record<string, unknown>, entry: Entry | undefined): Record<string, unknown> | undefined {
	if (!entry) return undefined;
	let found: Record<string, unknown> | undefined;
	const visit = (value: unknown) => {
		if (Array.isArray(value)) {
			for (const child of value) visit(child);
		} else if (object(value)) {
			const location = remoteEncryptedLocation(value),
				certificate = value.certificate_url;
			if (typeof location === "string" && hash(location) === entry.ciphertext && typeof certificate === "string") {
				try {
					const normalized = identity(certificate);
					if (normalized.chain === entry.chain && normalized.spki === entry.spki) found = value;
				} catch {}
			}
			for (const child of Object.values(value)) visit(child);
		}
	};
	visit(remote.spec);
	return found;
}
