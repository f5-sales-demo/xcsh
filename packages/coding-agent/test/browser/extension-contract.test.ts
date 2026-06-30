import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
	EXTENSION_CAPABILITIES,
	EXTENSION_CONTRACT_VERSION,
	EXTENSION_TOOL_NAMES,
} from "../../src/browser/capabilities.generated";
import capabilitiesJson from "../../src/browser/capabilities.json";
import { checkContractVersion, extractRequestedTools } from "../../src/browser/extension-contract";

const VENDORED = capabilitiesJson as {
	contractVersion: string;
	tools: Array<{ name: string; category: string }>;
};

describe("checkContractVersion", () => {
	it("is ok when the live version matches the expected one", () => {
		expect(checkContractVersion("1.0.0", "1.0.0")).toEqual({ ok: true });
	});

	it("flags a major mismatch as major, naming both versions", () => {
		const r = checkContractVersion("2.0.0", "1.0.0");
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.severity).toBe("major");
			expect(r.message).toContain("1.0.0");
			expect(r.message).toContain("2.0.0");
		}
	});

	it("flags a minor/patch mismatch as minor", () => {
		const r = checkContractVersion("1.2.0", "1.0.0");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.severity).toBe("minor");
	});

	it("treats a missing live version as a major mismatch", () => {
		const r = checkContractVersion(undefined, "1.0.0");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.severity).toBe("major");
	});
});

describe("generated extension capabilities", () => {
	it("matches the vendored capabilities.json (run generate-extension-capabilities to refresh)", () => {
		expect(EXTENSION_CAPABILITIES).toEqual(capabilitiesJson);
	});

	it("derives the tool-name list and contract version from the manifest", () => {
		expect(EXTENSION_TOOL_NAMES).toEqual(VENDORED.tools.map(t => t.name));
		expect(EXTENSION_CONTRACT_VERSION).toBe(VENDORED.contractVersion);
	});
});

describe("extractRequestedTools", () => {
	it('pulls the deduped tool names out of request("…") calls', () => {
		const src = `
			await this.#server.request("navigate", { url });
			unwrap(await this.#server.request("read_ax", {}), "read_ax");
			request("click", { ref });
			request("click", { ref });
		`;
		expect(extractRequestedTools(src).sort()).toEqual(["click", "navigate", "read_ax"]);
	});

	it("ignores quoted strings that are not request() tool names", () => {
		expect(extractRequestedTools(`unwrap(result, "screenshot")`)).toEqual([]);
	});
});

describe("extension contract drift guards", () => {
	const providerSource = readFileSync(new URL("../../src/browser/extension-provider.ts", import.meta.url), "utf8");
	// Non-meta tools the typed client intentionally does NOT wrap yet (driven
	// elsewhere, or part of a later behavioural layer). Adding a new extension tool
	// forces it to be wrapped here or acknowledged in this list.
	// query_dom is driven directly over the bridge (CDP fast-path used by the sweep's
	// resolver scripts), not via the typed ExtensionPage client.
	const KNOWN_UNWRAPPED = new Set(["wait_for_api_response", "query_dom"]);

	it("every tool the bridge client requests exists in the contract", () => {
		const unknown = extractRequestedTools(providerSource).filter(t => !EXTENSION_TOOL_NAMES.includes(t));
		expect(unknown).toEqual([]);
	});

	it("every non-meta contract tool is wrapped by the client or explicitly allowlisted", () => {
		const requested = new Set(extractRequestedTools(providerSource));
		const missing = VENDORED.tools
			.filter(t => t.category !== "meta")
			.map(t => t.name)
			.filter(name => !requested.has(name) && !KNOWN_UNWRAPPED.has(name));
		expect(missing).toEqual([]);
	});
});
