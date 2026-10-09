import * as fs from "node:fs/promises";
import { parseAllDocuments, stringify } from "yaml";

const MAX_DOCUMENT = 2 * 1024 * 1024;
const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
const aliases: Readonly<Record<string, string>> = {
	keyVersion: "key_version",
	modulusBase64: "modulus_base64",
	publicExponentBase64: "public_exponent_base64",
	policyId: "policy_id",
	policyInfo: "policy_info",
	clientName: "client_name",
	clientNameMatcher: "client_name_matcher",
	clientSelector: "client_selector",
	exactValues: "exact_values",
	regexValues: "regex_values",
};
function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!object(value)) return value;
	const entries = new Map<string, unknown>();
	for (const [key, item] of Object.entries(value)) {
		const name = aliases[key] ?? key;
		const normalized = canonicalize(item);
		if (entries.has(name)) throw new Error("Conflicting Blindfold field aliases");
		entries.set(name, normalized);
	}
	return Object.fromEntries(entries);
}
/** Preserve public information for retrieval; only explicitly known aliases change spelling. */
export function canonicalBlindfoldDocument(value: unknown, kind: "public-key" | "policy") {
	const material = canonicalize(value);
	normalizeBlindfoldDocument(material, kind);
	return material;
}
/** Native encryption receives only required, validated fields. */
export function normalizeBlindfoldDocument(value: unknown, kind: "public-key" | "policy") {
	const material = canonicalize(value);
	if (!object(material) || !object(material.data)) throw new Error("Malformed Blindfold public material document");
	const fields =
		kind === "public-key"
			? ["tenant", "key_version", "modulus_base64", "public_exponent_base64"]
			: ["tenant", "policy_id"];
	if (fields.some(field => field in material)) throw new Error("Ambiguous Blindfold public material document");
	const data = material.data;
	if (typeof data.tenant !== "string" || !label.test(data.tenant))
		throw new Error("Malformed Blindfold tenant identity");
	if (kind === "public-key") {
		if (
			!Number.isInteger(data.key_version) ||
			Number(data.key_version) < 1 ||
			Number(data.key_version) > 0xffffffff ||
			[data.modulus_base64, data.public_exponent_base64].some(
				v =>
					typeof v !== "string" ||
					!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v) ||
					v.length === 0 ||
					Buffer.from(v, "base64").toString("base64") !== v,
			)
		)
			throw new Error("Malformed Blindfold public key fields");
	} else if (
		typeof data.policy_id !== "string" ||
		!/^(0|[1-9][0-9]*)$/.test(data.policy_id) ||
		BigInt(data.policy_id) > 0xffffffffffffffffn
	)
		throw new Error("Malformed Blindfold policy ID");
	return { data: Object.fromEntries(fields.map(field => [field, data[field]])) };
}
export function parseBlindfoldDocument(text: string): unknown {
	if (Buffer.byteLength(text, "utf8") > MAX_DOCUMENT) throw new Error("Blindfold public material exceeds 2 MiB");
	const docs = parseAllDocuments(text, { uniqueKeys: true, merge: false });
	if (docs.length !== 1 || docs[0]!.errors.length)
		throw new Error("Malformed or ambiguous Blindfold public material document");
	return docs[0]!.toJS({ maxAliasCount: 0 });
}
export async function readBlindfoldResponse(response: Response): Promise<unknown> {
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Missing Blindfold public material response");
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			size += chunk.value.length;
			if (size > MAX_DOCUMENT) throw new Error("Blindfold public material exceeds 2 MiB");
			chunks.push(chunk.value);
		}
		return parseBlindfoldDocument(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
export async function readBlindfoldDocument(filename: string, kind: "public-key" | "policy") {
	let text: string;
	try {
		const file = await fs.open(filename, "r");
		try {
			const stat = await file.stat();
			if (!stat.isFile() || stat.size > MAX_DOCUMENT) throw new Error();
			const bytes = Buffer.alloc(MAX_DOCUMENT + 1);
			let size = 0;
			while (size < bytes.length) {
				const read = await file.read(bytes, size, bytes.length - size, null);
				if (!read.bytesRead) break;
				size += read.bytesRead;
			}
			if (size > MAX_DOCUMENT) throw new Error();
			text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
		} finally {
			await file.close();
		}
	} catch {
		throw new Error("Cannot read Blindfold public material; require a file no larger than 2 MiB");
	}
	try {
		return normalizeBlindfoldDocument(parseBlindfoldDocument(text), kind);
	} catch {
		throw new Error("Malformed or ambiguous Blindfold public material document");
	}
}
function camelize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(camelize);
	if (!object(value)) return value;
	const reverse = Object.fromEntries(Object.entries(aliases).map(([camel, snake]) => [snake, camel]));
	return Object.fromEntries(Object.entries(value).map(([key, item]) => [reverse[key] ?? key, camelize(item)]));
}
export function serializeBlindfoldDocument(material: unknown, output: "json" | "yaml" = "json", compatibility = false) {
	const value = compatibility ? camelize(material) : material;
	return output === "yaml" ? stringify(value) : `${JSON.stringify(value, null, 2)}\n`;
}
