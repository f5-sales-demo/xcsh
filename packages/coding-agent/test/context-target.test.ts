import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ContextResolver } from "@f5-sales-demo/pi-utils";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-target-"));
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
describe("source-aware target resolution", () => {
	it("distinguishes same-name identities and retains a differently named pointer's overrides", () => {
		const global = path.join(root, "global");
		const local = path.join(root, "local");
		fs.mkdirSync(global, { recursive: true });
		fs.mkdirSync(local);
		fs.writeFileSync(
			path.join(global, "demo.json"),
			JSON.stringify({
				name: "demo",
				apiUrl: "https://global.example.test",
				apiToken: "synthetic",
				defaultNamespace: "global",
				env: { XCSH_REGION: "global" },
			}),
		);
		fs.writeFileSync(
			path.join(local, "demo.json"),
			JSON.stringify({ context: "demo", overrides: { defaultNamespace: "local", env: { XCSH_REGION: "local" } } }),
		);
		fs.writeFileSync(
			path.join(local, "project.json"),
			JSON.stringify({ context: "demo", overrides: { defaultNamespace: "project" } }),
		);
		const resolver = new ContextResolver({
			paths: {
				getContextsDir: () => global,
				getActiveContextPath: () => "",
				getContextPath: n => path.join(global, `${n}.json`),
				getLocalContextsDir: () => local,
				getLocalActiveContextPath: () => "",
				getLocalContextPath: n => path.join(local, `${n}.json`),
			},
		});
		expect(resolver.resolveTarget({ name: "demo", source: "global" }, root)?.context.defaultNamespace).toBe("global");
		expect(resolver.resolveTarget({ name: "demo", source: "local" }, root)?.context.env?.XCSH_REGION).toBe("local");
		const project = resolver.resolveTarget({ name: "project", source: "local" }, root);
		expect(project?.context.name).toBe("project");
		expect(project?.context.defaultNamespace).toBe("project");
		expect(resolver.resolveTarget({ name: "../demo", source: "local" }, root)).toBeNull();
	});
});
