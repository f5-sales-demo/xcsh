import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { createCatalogKindResolver } from "@f5-sales-demo/pi-resource-management";
import { SPECIFICATION_BASE64, SPECIFICATION_RECEIPT, SPECIFICATION_SHA256 } from "./api-spec-index.generated.js";
import type { CoreCapabilities, SpecificationData } from "./types.js";
import { freezeJson } from "./util.js";

const bytes = gunzipSync(Buffer.from(SPECIFICATION_BASE64, "base64"), { maxOutputLength: 256 * 1024 * 1024 });
if (createHash("sha256").update(bytes).digest("hex") !== SPECIFICATION_SHA256)
	throw new Error("Bundled specification hash mismatch");
export const specification = freezeJson(JSON.parse(bytes.toString("utf8")) as SpecificationData);
if (specification.version !== SPECIFICATION_RECEIPT.version || specification.index.version !== specification.version) {
	throw new Error("Bundled specification provenance mismatch");
}
export const kindResolver = freezeJson(
	createCatalogKindResolver(specification.index, specification.validation, specification.catalog),
);
export const specificationReceipt = freezeJson(SPECIFICATION_RECEIPT);
export function getCapabilities(): CoreCapabilities {
	return freezeJson({
		protocol: "xcsh-f5-core",
		version: 1,
		specificationVersion: specification.version,
		specificationHash: SPECIFICATION_SHA256,
		capabilities: [
			"discovery",
			"specification-description",
			"inspection",
			"validation",
			"bound-planning",
			"exact-approval",
			"single-attempt-mutations",
		],
	});
}
/** CLI enrichment is optional and must match protocol and the immutable specification. */
export function negotiateCapabilities(value: unknown): {
	compatible: boolean;
	capabilities: CoreCapabilities;
	enrichment: readonly string[];
} {
	const baseline = getCapabilities();
	const candidate = value as Partial<CoreCapabilities> | undefined;
	const compatible =
		candidate?.protocol === baseline.protocol &&
		candidate?.version === baseline.version &&
		candidate?.specificationHash === baseline.specificationHash &&
		Array.isArray(candidate?.capabilities) &&
		candidate.capabilities.every(capability => typeof capability === "string");
	return {
		compatible,
		capabilities: baseline,
		enrichment: compatible
			? baseline.capabilities.filter(capability => candidate!.capabilities!.includes(capability))
			: [],
	};
}
