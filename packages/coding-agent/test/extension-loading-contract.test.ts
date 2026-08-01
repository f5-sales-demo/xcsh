import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { getProjectAgentDir, TempDir } from "@f5-sales-demo/pi-utils";
import { discoverAndLoadExtensions, loadExtensions } from "../src/extensibility/extensions/loader";
import { filterUserExtensionErrors, filterUserExtensions } from "./utils/filter-user-extensions";

/**
 * Characterization tests for the extension-loading contract.
 *
 * These pin the behavior that a future performance optimization (parallelizing
 * the load loop, pre-warming the app barrel, caching discovery) MUST preserve.
 * They assert against current behavior and are expected to stay green through
 * any such optimization — the "don't lose required functionality" guard.
 */
describe("extension loading contract", () => {
	let tempDir: TempDir;
	let extensionsDir: string;

	beforeEach(() => {
		tempDir = TempDir.createSync("@pi-ext-contract-");
		extensionsDir = path.join(getProjectAgentDir(tempDir.path()), "extensions");
		fs.mkdirSync(extensionsDir, { recursive: true });
	});
	afterEach(() => {
		tempDir.removeSync();
	});

	/** Write an extension source file into extensions/ and return its absolute path. */
	const writeExt = (name: string, body: string): string => {
		const p = path.join(extensionsDir, name);
		fs.writeFileSync(p, body);
		return p;
	};

	const toolAndCommand = (id: string) => `
		export default function (pi) {
			const { Type } = pi.typebox;
			pi.registerCommand("cmd_${id}", { handler: async () => {} });
			pi.registerTool({
				name: "tool_${id}",
				label: "tool_${id}",
				description: "Test tool ${id}",
				parameters: Type.Object({}),
				execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
			});
		}
	`;

	const providerExt = (name: string) => `
		export default function (pi) {
			pi.registerProvider("${name}", { models: [] });
		}
	`;

	// --- Registration contract ---

	it("registers tools and commands from a loaded extension, with no errors", async () => {
		writeExt("foo.ts", toolAndCommand("foo"));

		const result = await discoverAndLoadExtensions([], tempDir.path());
		const extensions = filterUserExtensions(result.extensions);
		const errors = filterUserExtensionErrors(result.errors);

		expect(errors).toHaveLength(0);
		expect(extensions).toHaveLength(1);
		expect([...extensions[0].tools.keys()]).toContain("tool_foo");
		expect([...extensions[0].commands.keys()]).toContain("cmd_foo");
	});

	it("surfaces service-status and flag registrations on the loaded extension", async () => {
		writeExt(
			"svc.ts",
			`
			export default function (pi) {
				pi.registerServiceStatus({ name: "MySvc", check: async () => ({ state: "connected" }) });
				pi.registerFlag("myflag", { type: "boolean", default: true });
			}
		`,
		);

		const result = await discoverAndLoadExtensions([], tempDir.path());
		const ext = filterUserExtensions(result.extensions)[0];

		expect(ext).toBeDefined();
		expect([...ext.serviceStatuses.keys()]).toContain("MySvc");
		expect([...ext.flags.keys()]).toContain("myflag");
	});

	// --- Ordering contract (the property most at risk under parallelization) ---
	// loadExtensions() takes an explicit ordered path list; the result must follow it.

	it("preserves input path order in the loaded extensions", async () => {
		const paths = [
			writeExt("a.ts", toolAndCommand("a")),
			writeExt("b.ts", toolAndCommand("b")),
			writeExt("c.ts", toolAndCommand("c")),
		];

		const result = await loadExtensions(paths, tempDir.path());

		expect(result.errors).toHaveLength(0);
		expect(result.extensions.map(e => path.basename(e.path))).toEqual(["a.ts", "b.ts", "c.ts"]);
	});

	it("preserves input order of provider registrations with correct sourceId", async () => {
		const paths = [
			writeExt("p1.ts", providerExt("prov_one")),
			writeExt("p2.ts", providerExt("prov_two")),
			writeExt("p3.ts", providerExt("prov_three")),
		];

		const result = await loadExtensions(paths, tempDir.path());
		const regs = result.runtime.pendingProviderRegistrations;

		expect(regs.map(r => r.name)).toEqual(["prov_one", "prov_two", "prov_three"]);
		expect(regs.map(r => path.basename(r.sourceId))).toEqual(["p1.ts", "p2.ts", "p3.ts"]);
	});

	// --- Partial-failure isolation ---

	it("captures a throwing extension in errors without blocking the others", async () => {
		const paths = [
			writeExt("ok1.ts", toolAndCommand("ok1")),
			writeExt("boom.ts", `export default function () { throw new Error("kaboom"); }`),
			writeExt("ok2.ts", toolAndCommand("ok2")),
		];

		const result = await loadExtensions(paths, tempDir.path());

		expect(result.extensions.map(e => path.basename(e.path))).toEqual(["ok1.ts", "ok2.ts"]);
		expect(result.errors).toHaveLength(1);
		expect(path.basename(result.errors[0].path)).toBe("boom.ts");
		expect(result.errors[0].error).toMatch(/kaboom/);
	});

	it("captures a non-function export as an error without blocking the others", async () => {
		const paths = [writeExt("bad.ts", `export default 42;`), writeExt("good.ts", toolAndCommand("good"))];

		const result = await loadExtensions(paths, tempDir.path());

		expect(result.extensions.map(e => path.basename(e.path))).toEqual(["good.ts"]);
		expect(result.errors.map(e => path.basename(e.path))).toEqual(["bad.ts"]);
	});

	// --- Perf guard (catastrophic-regression only; NOT a tight budget) ---
	// Generous bound following test/tools/render-mermaid-tool.test.ts — single run,
	// large margin. Guards against a pathological load-time regression, not micro-perf.

	it("cold-loads a fixture set within a generous time budget", async () => {
		const paths = Array.from({ length: 6 }, (_, i) => writeExt(`perf${i}.ts`, toolAndCommand(`perf${i}`)));

		const start = Bun.nanoseconds();
		const result = await loadExtensions(paths, tempDir.path());
		const elapsedMs = (Bun.nanoseconds() - start) / 1e6;

		expect(result.extensions).toHaveLength(6);
		expect(result.errors).toHaveLength(0);
		// Catastrophic-regression guard; typical dev load is well under this.
		expect(elapsedMs).toBeLessThan(20_000);
	});
});
