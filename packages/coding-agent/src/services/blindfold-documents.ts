import * as fs from "node:fs/promises";
import { parseAllDocuments, stringify } from "yaml";

const MAX_DOCUMENT = 2 * 1024 * 1024;
const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Only the observed API data wrapper is accepted; unrelated fields never reach native encryption. */
export function normalizeBlindfoldDocument(value: unknown, kind: "public-key" | "policy") {
	if (!object(value) || !object(value.data)) throw new Error("Malformed Blindfold public material document");
	const fields =
		kind === "public-key"
			? ["tenant", "key_version", "modulus_base64", "public_exponent_base64"]
			: ["tenant", "policy_id"];
	if (fields.some(field => field in value)) throw new Error("Ambiguous Blindfold public material document");
	const data = value.data;
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
					v.length === 0,
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
		const docs = parseAllDocuments(text, { uniqueKeys: true, merge: false });
		if (docs.length !== 1 || docs[0]!.errors.length) throw new Error();
		return normalizeBlindfoldDocument(docs[0]!.toJS({ maxAliasCount: 0 }), kind);
	} catch {
		throw new Error("Malformed or ambiguous Blindfold public material document");
	}
}
export function serializeBlindfoldDocument(material: unknown, output: "json" | "yaml" = "json") {
	return output === "yaml" ? stringify(material) : `${JSON.stringify(material, null, 2)}\n`;
}
