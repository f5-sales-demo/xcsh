/**
 * Consumption of the Chrome extension's capability contract.
 *
 * The extension publishes a machine-readable `capabilities` manifest (vendored +
 * baked in via `capabilities.generated.ts`). This module holds the pure logic for
 * the connect-time version handshake; the bridge provider wires it to the live
 * `capabilities` tool response.
 */

export type ContractCheck = { ok: true } | { ok: false; severity: "major" | "minor"; message: string };

/**
 * Compare the extension's live `contractVersion` against the one xcsh was built
 * against. A differing MAJOR (or a missing live version) is a breaking mismatch;
 * a differing minor/patch is a soft, additive drift.
 */
export function checkContractVersion(live: string | undefined, expected: string): ContractCheck {
	if (!live) {
		return {
			ok: false,
			severity: "major",
			message: `extension did not report a contract version (xcsh expects ${expected}); it may predate the capability contract`,
		};
	}
	if (live === expected) return { ok: true };
	const liveMajor = live.split(".")[0];
	const expectedMajor = expected.split(".")[0];
	const severity = liveMajor === expectedMajor ? "minor" : "major";
	return {
		ok: false,
		severity,
		message: `extension contract version ${live} != ${expected} that xcsh was built against`,
	};
}

/**
 * Pull the deduped set of tool names from `request("tool", …)` call sites in
 * source text — used to drift-test the typed bridge client (`BridgeExtensionPage`)
 * against the published contract, so a renamed/removed extension tool fails CI.
 */
export function extractRequestedTools(source: string): string[] {
	const out = new Set<string>();
	const re = /\brequest\(\s*["']([a-zA-Z0-9_]+)["']/g;
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex exec loop
	while ((m = re.exec(source)) !== null) out.add(m[1]);
	return [...out];
}
