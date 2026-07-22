import { describe, expect, it } from "bun:test";
import {
	CLIENT_HOSTS,
	type ClientHost,
	DEFAULT_HOST,
	HOST_PROFILES,
	hostProfile,
	isClientHost,
} from "@f5-sales-demo/xcsh/browser/host-profiles";

/** Substrings that must NEVER leak into a document (Office) host prompt — they
 * are Chrome-extension-only concepts that would confuse an Office assistant. */
const BROWSER_ONLY_TERMS = ["Chrome", "browser", "port 19222", "catalog_workflow_runner"] as const;

describe("host profiles", () => {
	it("exposes every ClientHost in CLIENT_HOSTS", () => {
		expect([...CLIENT_HOSTS].sort()).toEqual(["chrome", "excel", "powerpoint", "word"]);
	});

	it("has a profile for every ClientHost", () => {
		for (const host of CLIENT_HOSTS) {
			expect(HOST_PROFILES[host]).toBeDefined();
			expect(typeof HOST_PROFILES[host].systemPrompt).toBe("string");
			expect(HOST_PROFILES[host].systemPrompt.length).toBeGreaterThan(0);
		}
	});

	it("chrome is a browser profile that mentions Chrome", () => {
		const p = HOST_PROFILES.chrome;
		expect(p.kind).toBe("browser");
		expect(p.systemPrompt).toContain("Chrome");
	});

	for (const host of ["excel", "powerpoint", "word"] as const) {
		it(`${host} is a document profile that mentions its app and no browser-only terms`, () => {
			const p = HOST_PROFILES[host];
			expect(p.kind).toBe("document");
			const app = { excel: "Excel", powerpoint: "PowerPoint", word: "Word" }[host];
			expect(p.systemPrompt).toContain(app);
			for (const term of BROWSER_ONLY_TERMS) {
				expect(p.systemPrompt).not.toContain(term);
			}
		});
	}

	it("excel prompt thinks in cells/ranges/formulas", () => {
		const t = HOST_PROFILES.excel.systemPrompt;
		expect(t).toContain("workbook");
		expect(t.toLowerCase()).toContain("formula");
	});

	it("powerpoint prompt thinks in slides", () => {
		const t = HOST_PROFILES.powerpoint.systemPrompt;
		expect(t).toContain("presentation");
		expect(t.toLowerCase()).toContain("slide");
	});

	it("word prompt thinks in the document", () => {
		const t = HOST_PROFILES.word.systemPrompt;
		expect(t).toContain("document");
	});

	it("isClientHost accepts the wire values and rejects others", () => {
		for (const host of CLIENT_HOSTS) expect(isClientHost(host)).toBe(true);
		expect(isClientHost("outlook")).toBe(false);
		expect(isClientHost("Excel")).toBe(false);
		expect(isClientHost(null)).toBe(false);
		expect(isClientHost(undefined)).toBe(false);
		expect(isClientHost(42)).toBe(false);
	});

	it("hostProfile falls back to the DEFAULT_HOST (chrome) for null/undefined", () => {
		expect(DEFAULT_HOST).toBe("chrome");
		expect(hostProfile(null)).toBe(HOST_PROFILES.chrome);
		expect(hostProfile(undefined)).toBe(HOST_PROFILES.chrome);
		const excel: ClientHost = "excel";
		expect(hostProfile(excel)).toBe(HOST_PROFILES.excel);
	});
});
