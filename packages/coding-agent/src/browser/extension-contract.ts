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

export interface ManifestTool {
	name: string;
	summary: string;
	category: string;
	params?: { properties?: Record<string, { type?: string }>; required?: string[] };
	flags?: { readOnly?: boolean; mutates?: boolean; requiresExplainMode?: boolean };
}
export interface Manifest {
	contractVersion: string;
	tools: ManifestTool[];
}

/** Render a tool's JSON-Schema params as a compact `{ a: t, b?: t }` signature. */
function renderParams(params: ManifestTool["params"]): string {
	const props = params?.properties ?? {};
	const required = new Set(params?.required ?? []);
	const keys = Object.keys(props);
	if (keys.length === 0) return "{}";
	const parts = keys.map(k => {
		const t = props[k]?.type ?? "unknown";
		const ty = t === "array" ? "unknown[]" : t;
		return `${k}${required.has(k) ? "" : "?"}: ${ty}`;
	});
	return `{ ${parts.join(", ")} }`;
}

function renderFlags(flags: ManifestTool["flags"]): string {
	const tags: string[] = [];
	if (flags?.mutates) tags.push("mutates");
	if (flags?.readOnly) tags.push("read-only");
	if (flags?.requiresExplainMode) tags.push("requires explain mode");
	return tags.length ? ` _(${tags.join(", ")})_` : "";
}

/**
 * Render the extension's tool contract as a markdown signature reference, grouped
 * by category. Authoritative + generated, so the model's tool signatures are exact
 * and never drift; pairs with the hand-written guidance in `extension-api.md`.
 */
export function renderToolReference(manifest: Manifest): string {
	const byCategory = new Map<string, ManifestTool[]>();
	for (const t of manifest.tools) {
		const list = byCategory.get(t.category) ?? [];
		list.push(t);
		byCategory.set(t.category, list);
	}
	const lines: string[] = [
		"# xcsh extension — tool signatures",
		"",
		`> Authoritative signatures generated from the extension's capability contract (contract ${manifest.contractVersion}). Use these exact params; pair with the guidance above for when/why to use each tool.`,
		"",
	];
	for (const [category, tools] of byCategory) {
		lines.push(`## ${category}`, "");
		for (const t of tools) {
			const sig = renderParams(t.params);
			const head = sig === "{}" ? `\`${t.name}\`` : `\`${t.name} ${sig}\``;
			lines.push(`- ${head}${renderFlags(t.flags)} — ${t.summary}`);
		}
		lines.push("");
	}
	return lines.join("\n");
}
