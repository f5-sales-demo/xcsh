// packages/utils/test/xcsh-context-resolver-resolve.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { xcshContextPaths } from "../src/xcsh-context-paths";
import { ContextResolver } from "../src/xcsh-context-resolver";

describe("ContextResolver.resolve", () => {
	let tmpDir: string;
	let projectDir: string;
	let globalConfigDir: string;
	let localContextsDir: string;
	let globalContextsDir: string;
	const originalEnv = { ...process.env };

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-resolver-test-"));
		projectDir = path.join(tmpDir, "project");
		globalConfigDir = path.join(tmpDir, "global-config", "xcsh");
		localContextsDir = path.join(projectDir, ".xcsh", "contexts");
		globalContextsDir = path.join(globalConfigDir, "contexts");

		fs.mkdirSync(localContextsDir, { recursive: true, mode: 0o700 });
		fs.mkdirSync(globalContextsDir, { recursive: true, mode: 0o700 });

		process.env.XDG_CONFIG_HOME = path.join(tmpDir, "global-config");
		delete process.env.XCSH_API_URL;
		delete process.env.XCSH_API_TOKEN;
	});

	afterEach(() => {
		process.env = { ...originalEnv };
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns null when no context is configured anywhere", async () => {
		const resolver = new ContextResolver({ paths: xcshContextPaths });
		const result = await resolver.resolve(projectDir);
		expect(result).toBeNull();
	});

	it("resolves env vars with highest priority", async () => {
		process.env.XCSH_API_URL = "https://env.example.com";
		process.env.XCSH_API_TOKEN = "env-token";
		const resolver = new ContextResolver({ paths: xcshContextPaths });
		const result = await resolver.resolve(projectDir);
		expect(result).not.toBeNull();
		expect(result!.source).toBe("env");
		expect(result!.context.apiUrl).toBe("https://env.example.com");
	});

	it("resolves local inline context over global", async () => {
		// Write a global context
		const globalCtx = {
			name: "global-prod",
			apiUrl: "https://global.example.com",
			apiToken: "g-tok",
			defaultNamespace: "global-ns",
		};
		fs.writeFileSync(path.join(globalContextsDir, "global-prod.json"), JSON.stringify(globalCtx), { mode: 0o600 });
		fs.writeFileSync(path.join(globalConfigDir, "active_context"), "global-prod", { mode: 0o600 });

		// Write a local inline context
		const localCtx = {
			name: "local-dev",
			apiUrl: "https://local.example.com",
			apiToken: "l-tok",
			defaultNamespace: "local-ns",
		};
		fs.writeFileSync(path.join(localContextsDir, "local-dev.json"), JSON.stringify(localCtx), { mode: 0o600 });
		fs.writeFileSync(path.join(localContextsDir, "active_context"), "local-dev", { mode: 0o600 });

		const resolver = new ContextResolver({ paths: xcshContextPaths });
		const result = await resolver.resolve(projectDir);
		expect(result).not.toBeNull();
		expect(result!.source).toBe("local");
		expect(result!.context.apiUrl).toBe("https://local.example.com");
		expect(result!.context.name).toBe("local-dev");
	});

	it("resolves local pointer context through to global", async () => {
		const globalCtx = {
			name: "prod-tenant",
			apiUrl: "https://prod.example.com",
			apiToken: "p-tok",
			defaultNamespace: "system",
			env: { GLOBAL_VAR: "global" },
		};
		fs.writeFileSync(path.join(globalContextsDir, "prod-tenant.json"), JSON.stringify(globalCtx), { mode: 0o600 });

		const pointer = {
			context: "prod-tenant",
			overrides: { defaultNamespace: "my-project-ns", env: { LOCAL_VAR: "local" } },
		};
		fs.writeFileSync(path.join(localContextsDir, "staging.json"), JSON.stringify(pointer), { mode: 0o600 });
		fs.writeFileSync(path.join(localContextsDir, "active_context"), "staging", { mode: 0o600 });

		const resolver = new ContextResolver({ paths: xcshContextPaths });
		const result = await resolver.resolve(projectDir);
		expect(result).not.toBeNull();
		expect(result!.source).toBe("local");
		expect(result!.context.apiUrl).toBe("https://prod.example.com");
		expect(result!.context.defaultNamespace).toBe("my-project-ns");
		expect(result!.context.env).toEqual({ GLOBAL_VAR: "global", LOCAL_VAR: "local" });
	});

	it("falls through to global when local active_context references missing file", async () => {
		fs.writeFileSync(path.join(localContextsDir, "active_context"), "nonexistent", { mode: 0o600 });

		const globalCtx = {
			name: "fallback",
			apiUrl: "https://fallback.example.com",
			apiToken: "f-tok",
			defaultNamespace: "fb-ns",
		};
		fs.writeFileSync(path.join(globalContextsDir, "fallback.json"), JSON.stringify(globalCtx), { mode: 0o600 });
		fs.writeFileSync(path.join(globalConfigDir, "active_context"), "fallback", { mode: 0o600 });

		const resolver = new ContextResolver({ paths: xcshContextPaths });
		const result = await resolver.resolve(projectDir);
		expect(result).not.toBeNull();
		expect(result!.source).toBe("global");
		expect(result!.context.name).toBe("fallback");
	});

	it("errors when pointer references nonexistent global context", async () => {
		const pointer = { context: "does-not-exist" };
		fs.writeFileSync(path.join(localContextsDir, "broken.json"), JSON.stringify(pointer), { mode: 0o600 });
		fs.writeFileSync(path.join(localContextsDir, "active_context"), "broken", { mode: 0o600 });

		const resolver = new ContextResolver({ paths: xcshContextPaths });
		const result = await resolver.resolve(projectDir);
		expect(result).toBeNull();
	});

	it("skips silently when .xcsh/contexts/ is empty", async () => {
		const globalCtx = {
			name: "global-only",
			apiUrl: "https://g.example.com",
			apiToken: "tok",
			defaultNamespace: "ns",
		};
		fs.writeFileSync(path.join(globalContextsDir, "global-only.json"), JSON.stringify(globalCtx), { mode: 0o600 });
		fs.writeFileSync(path.join(globalConfigDir, "active_context"), "global-only", { mode: 0o600 });

		const resolver = new ContextResolver({ paths: xcshContextPaths });
		const result = await resolver.resolve(projectDir);
		expect(result).not.toBeNull();
		expect(result!.source).toBe("global");
	});

	it("returns env source even when local and global exist", async () => {
		process.env.XCSH_API_URL = "https://env-wins.example.com";
		process.env.XCSH_API_TOKEN = "env-token";

		const localCtx = { name: "local", apiUrl: "https://local.example.com", apiToken: "l", defaultNamespace: "ns" };
		fs.writeFileSync(path.join(localContextsDir, "local.json"), JSON.stringify(localCtx), { mode: 0o600 });
		fs.writeFileSync(path.join(localContextsDir, "active_context"), "local", { mode: 0o600 });

		const resolver = new ContextResolver({ paths: xcshContextPaths });
		const result = await resolver.resolve(projectDir);
		expect(result!.source).toBe("env");
	});

	it("rejects file with both 'context' and 'apiUrl'", async () => {
		const invalid = { context: "prod", apiUrl: "https://x.com" };
		fs.writeFileSync(path.join(localContextsDir, "bad.json"), JSON.stringify(invalid), { mode: 0o600 });
		fs.writeFileSync(path.join(localContextsDir, "active_context"), "bad", { mode: 0o600 });

		const globalCtx = { name: "fallback", apiUrl: "https://fb.example.com", apiToken: "tok", defaultNamespace: "ns" };
		fs.writeFileSync(path.join(globalContextsDir, "fallback.json"), JSON.stringify(globalCtx), { mode: 0o600 });
		fs.writeFileSync(path.join(globalConfigDir, "active_context"), "fallback", { mode: 0o600 });

		const resolver = new ContextResolver({ paths: xcshContextPaths });
		const result = await resolver.resolve(projectDir);
		expect(result!.source).toBe("global");
	});
});

describe("ContextResolver.findLocalContextsDir", () => {
	let tmpDir: string;
	const originalEnv = { ...process.env };

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-find-test-"));
	});

	afterEach(() => {
		process.env = { ...originalEnv };
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns path when .xcsh/contexts/ exists in cwd", () => {
		const ctxDir = path.join(tmpDir, ".xcsh", "contexts");
		fs.mkdirSync(ctxDir, { recursive: true });
		const resolver = new ContextResolver({ paths: xcshContextPaths });
		expect(resolver.findLocalContextsDir(tmpDir)).toBe(ctxDir);
	});

	it("returns null when no .xcsh/contexts/ exists", () => {
		const resolver = new ContextResolver({ paths: xcshContextPaths });
		expect(resolver.findLocalContextsDir(tmpDir)).toBeNull();
	});
});

describe("ContextResolver.resolve apiUrl normalization", () => {
	let tmpDir: string;
	let projectDir: string;
	let localContextsDir: string;
	const originalEnv = { ...process.env };

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-resolver-norm-"));
		projectDir = path.join(tmpDir, "project");
		localContextsDir = path.join(projectDir, ".xcsh", "contexts");
		fs.mkdirSync(localContextsDir, { recursive: true, mode: 0o700 });
		process.env.XDG_CONFIG_HOME = path.join(tmpDir, "global-config");
		delete process.env.XCSH_API_URL;
		delete process.env.XCSH_API_TOKEN;
	});

	afterEach(() => {
		process.env = { ...originalEnv };
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("strips trailing slashes from the resolved apiUrl (local inline)", async () => {
		const localCtx = {
			name: "local-dev",
			apiUrl: "https://local.example.com/",
			apiToken: "l-tok",
			defaultNamespace: "local-ns",
		};
		fs.writeFileSync(path.join(localContextsDir, "local-dev.json"), JSON.stringify(localCtx), { mode: 0o600 });
		fs.writeFileSync(path.join(localContextsDir, "active_context"), "local-dev", { mode: 0o600 });

		const resolver = new ContextResolver({ paths: xcshContextPaths });
		const result = await resolver.resolve(projectDir);
		expect(result!.context.apiUrl).toBe("https://local.example.com");
	});

	it("strips trailing slashes from the resolved apiUrl (env)", async () => {
		process.env.XCSH_API_URL = "https://env.example.com/";
		process.env.XCSH_API_TOKEN = "env-token";
		const resolver = new ContextResolver({ paths: xcshContextPaths });
		const result = await resolver.resolve(projectDir);
		expect(result!.context.apiUrl).toBe("https://env.example.com");
	});
});
