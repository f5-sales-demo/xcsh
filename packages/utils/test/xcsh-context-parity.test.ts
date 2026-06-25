// packages/utils/test/xcsh-context-parity.test.ts
//
// GOLDEN PARITY FIXTURES — keep byte-identical with the VS Code extension's
// copy at vscode-xcsh `src/test/unit/contextParity.test.ts`. Both drive the
// SAME shared resolver (xcsh injects `xcshContextPaths`; the extension injects
// its `contextPaths` provider) and MUST produce identical outcomes. If you change
// a fixture or expectation here, change it there in the same PR — that is the
// whole point of this guard.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { xcshContextPaths } from "../src/xcsh-context-paths";
import { ContextResolver } from "../src/xcsh-context-resolver";

export interface ParityFixture {
	name: string;
	env?: Record<string, string>;
	/** Files under <project>/.xcsh/contexts/ (name → contents). */
	local?: Record<string, string>;
	localActive?: string;
	/** Files under <global>/contexts/ (name → contents). */
	global?: Record<string, string>;
	globalActive?: string;
	expect: null | {
		source: "env" | "local" | "global";
		name?: string;
		apiUrl?: string;
		defaultNamespace?: string;
		env?: Record<string, string>;
	};
}

// The shared, host-agnostic expectations.
export const PARITY_FIXTURES: ParityFixture[] = [
	{
		name: "env vars win and are reduced to origin",
		env: {
			XCSH_API_URL: "https://env.example.com/web/home?iss=x#f",
			XCSH_API_TOKEN: "env-tok",
			XCSH_NAMESPACE: "ns",
		},
		local: {
			"dev.json": JSON.stringify({
				name: "dev",
				apiUrl: "https://l.example.com",
				apiToken: "t",
				defaultNamespace: "d",
			}),
		},
		localActive: "dev",
		expect: { source: "env", apiUrl: "https://env.example.com", defaultNamespace: "ns" },
	},
	{
		name: "local inline over global; apiUrl reduced to origin",
		local: {
			"dev.json": JSON.stringify({
				name: "dev",
				apiUrl: "https://local.example.com/api/",
				apiToken: "l",
				defaultNamespace: "local-ns",
			}),
		},
		localActive: "dev",
		global: {
			"prod.json": JSON.stringify({
				name: "prod",
				apiUrl: "https://global.example.com",
				apiToken: "g",
				defaultNamespace: "g-ns",
			}),
		},
		globalActive: "prod",
		expect: { source: "local", name: "dev", apiUrl: "https://local.example.com", defaultNamespace: "local-ns" },
	},
	{
		name: "local pointer resolves through to global with merged overrides",
		global: {
			"prod.json": JSON.stringify({
				name: "prod",
				apiUrl: "https://prod.example.com",
				apiToken: "p",
				defaultNamespace: "system",
				env: { GLOBAL: "g" },
			}),
		},
		local: {
			"staging.json": JSON.stringify({
				context: "prod",
				overrides: { defaultNamespace: "my-ns", env: { LOCAL: "l" } },
			}),
		},
		localActive: "staging",
		expect: {
			source: "local",
			apiUrl: "https://prod.example.com",
			defaultNamespace: "my-ns",
			env: { GLOBAL: "g", LOCAL: "l" },
		},
	},
	{
		name: "pointer to a missing global yields no context",
		local: { "broken.json": JSON.stringify({ context: "does-not-exist" }) },
		localActive: "broken",
		expect: null,
	},
	{
		name: "file with both context and apiUrl is rejected; falls through to global",
		local: { "bad.json": JSON.stringify({ context: "prod", apiUrl: "https://x.example.com" }) },
		localActive: "bad",
		global: {
			"fallback.json": JSON.stringify({
				name: "fallback",
				apiUrl: "https://fb.example.com",
				apiToken: "f",
				defaultNamespace: "fb",
			}),
		},
		globalActive: "fallback",
		expect: { source: "global", name: "fallback", apiUrl: "https://fb.example.com" },
	},
	{
		name: "reserved active-context name is rejected; falls through to global",
		local: {
			"list.json": JSON.stringify({
				name: "list",
				apiUrl: "https://x.example.com",
				apiToken: "t",
				defaultNamespace: "d",
			}),
		},
		localActive: "list",
		global: {
			"fallback.json": JSON.stringify({
				name: "fallback",
				apiUrl: "https://fb.example.com",
				apiToken: "f",
				defaultNamespace: "fb",
			}),
		},
		globalActive: "fallback",
		expect: { source: "global", name: "fallback" },
	},
	{
		name: "inline context missing a required field is rejected",
		local: { "partial.json": JSON.stringify({ name: "partial", apiUrl: "https://x.example.com" }) },
		localActive: "partial",
		expect: null,
	},
];

describe("context resolution parity (xcsh host)", () => {
	let tmpDir: string;
	let projectDir: string;
	const originalEnv = { ...process.env };

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-parity-"));
		projectDir = path.join(tmpDir, "project");
		fs.mkdirSync(path.join(projectDir, ".xcsh", "contexts"), { recursive: true, mode: 0o700 });
		fs.mkdirSync(path.join(tmpDir, "global-config", "xcsh", "contexts"), { recursive: true, mode: 0o700 });
		process.env.XDG_CONFIG_HOME = path.join(tmpDir, "global-config");
		delete process.env.XCSH_API_URL;
		delete process.env.XCSH_API_TOKEN;
		delete process.env.XCSH_NAMESPACE;
	});

	afterEach(() => {
		process.env = { ...originalEnv };
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	for (const fx of PARITY_FIXTURES) {
		it(fx.name, async () => {
			const localCtxDir = path.join(projectDir, ".xcsh", "contexts");
			const globalCtxDir = path.join(tmpDir, "global-config", "xcsh", "contexts");
			for (const [file, body] of Object.entries(fx.local ?? {})) {
				fs.writeFileSync(path.join(localCtxDir, file), body, { mode: 0o600 });
			}
			if (fx.localActive)
				fs.writeFileSync(path.join(localCtxDir, "active_context"), fx.localActive, { mode: 0o600 });
			for (const [file, body] of Object.entries(fx.global ?? {})) {
				fs.writeFileSync(path.join(globalCtxDir, file), body, { mode: 0o600 });
			}
			if (fx.globalActive) {
				fs.writeFileSync(path.join(tmpDir, "global-config", "xcsh", "active_context"), fx.globalActive, {
					mode: 0o600,
				});
			}
			for (const [k, v] of Object.entries(fx.env ?? {})) process.env[k] = v;

			const resolver = new ContextResolver({ paths: xcshContextPaths });
			const result = await resolver.resolve(projectDir);

			if (fx.expect === null) {
				expect(result).toBeNull();
				return;
			}
			expect(result).not.toBeNull();
			expect(result?.source).toBe(fx.expect.source);
			if (fx.expect.name !== undefined) expect(result?.context.name).toBe(fx.expect.name);
			if (fx.expect.apiUrl !== undefined) expect(result?.context.apiUrl).toBe(fx.expect.apiUrl);
			if (fx.expect.defaultNamespace !== undefined) {
				expect(result?.context.defaultNamespace).toBe(fx.expect.defaultNamespace);
			}
			if (fx.expect.env !== undefined) expect(result?.context.env).toEqual(fx.expect.env);
		});
	}
});
