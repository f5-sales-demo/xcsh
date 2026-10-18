import { createHash } from "node:crypto";

/** Bind the adapter to its source and package policy. */
export function codePresentationFingerprint(sources: readonly Uint8Array[], manifest: Uint8Array): string {
	const hash = createHash("sha256");
	for (const source of sources) hash.update(source);
	const policy = JSON.parse(new TextDecoder().decode(manifest));
	// Release numbering does not change the browser presentation policy.
	delete policy.version;
	hash.update(JSON.stringify(policy));
	return hash.digest("hex");
}
