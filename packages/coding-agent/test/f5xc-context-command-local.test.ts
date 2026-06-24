import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { registerLocales } from "@f5xc-salesdemos/pi-utils";
import { locales } from "../src/locales/index";

registerLocales(locales);

import { setProjectDir } from "@f5xc-salesdemos/pi-utils";
import { ContextService } from "../src/services/f5xc-context";
import { handleContextCommand } from "../src/services/f5xc-context-command";

describe("/context list with local contexts", () => {
	let tmpDir: string;
	let output: string[];
	const originalEnv = { ...process.env };

	const ctx = {
		showStatus: (msg: string) => {
			output.push(msg);
		},
		showError: (msg: string) => {
			output.push(`ERROR: ${msg}`);
		},
		editor: {
			setText: (text: string) => {
				output.push(text);
			},
		},
	};

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f5xc-cmd-local-"));
		output = [];

		const localContextsDir = path.join(tmpDir, ".xcsh", "contexts");
		const globalConfigDir = path.join(tmpDir, "global-config", "f5xc", "contexts");
		fs.mkdirSync(localContextsDir, { recursive: true, mode: 0o700 });
		fs.mkdirSync(globalConfigDir, { recursive: true, mode: 0o700 });

		process.env.XDG_CONFIG_HOME = path.join(tmpDir, "global-config");
		delete process.env.F5XC_API_URL;
		delete process.env.F5XC_API_TOKEN;

		setProjectDir(tmpDir);
		ContextService._resetForTest();
	});

	afterEach(() => {
		ContextService._resetForTest();
		process.env = { ...originalEnv };
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("shows local and global context groups in list output", async () => {
		// Create a local context
		const localCtx = { name: "local-staging", apiUrl: "https://l.com", apiToken: "tok", defaultNamespace: "ns" };
		fs.writeFileSync(path.join(tmpDir, ".xcsh", "contexts", "local-staging.json"), JSON.stringify(localCtx), {
			mode: 0o600,
		});

		// Create a global context
		const globalCtx = { name: "global-prod", apiUrl: "https://g.com", apiToken: "tok", defaultNamespace: "ns" };
		fs.writeFileSync(
			path.join(tmpDir, "global-config", "f5xc", "contexts", "global-prod.json"),
			JSON.stringify(globalCtx),
			{ mode: 0o600 },
		);

		ContextService.init(path.join(tmpDir, "global-config", "f5xc"));
		await handleContextCommand({ name: "context", args: "list", text: "/context list" }, ctx);

		const combined = output.join("\n");
		expect(combined).toContain("local-staging");
		expect(combined).toContain("global-prod");
	});
});

describe("/context link", () => {
	let tmpDir: string;
	let output: string[];
	const originalEnv = { ...process.env };

	const ctx = {
		showStatus: (msg: string) => {
			output.push(msg);
		},
		showError: (msg: string) => {
			output.push(`ERROR: ${msg}`);
		},
		editor: {
			setText: (text: string) => {
				output.push(text);
			},
		},
	};

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f5xc-cmd-link-"));
		output = [];

		const globalConfigDir = path.join(tmpDir, "global-config", "f5xc", "contexts");
		fs.mkdirSync(globalConfigDir, { recursive: true, mode: 0o700 });

		process.env.XDG_CONFIG_HOME = path.join(tmpDir, "global-config");
		delete process.env.F5XC_API_URL;
		delete process.env.F5XC_API_TOKEN;

		setProjectDir(tmpDir);
		ContextService._resetForTest();
	});

	afterEach(() => {
		ContextService._resetForTest();
		process.env = { ...originalEnv };
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("creates a pointer file and sets active_context", async () => {
		// Create a global context to link to
		const globalCtx = {
			name: "prod",
			apiUrl: "https://prod.example.com",
			apiToken: "tok",
			defaultNamespace: "default",
		};
		fs.writeFileSync(path.join(tmpDir, "global-config", "f5xc", "contexts", "prod.json"), JSON.stringify(globalCtx), {
			mode: 0o600,
		});

		ContextService.init(path.join(tmpDir, "global-config", "f5xc"));
		await handleContextCommand({ name: "context", args: "link prod", text: "/context link prod" }, ctx);

		const combined = output.join("\n");
		expect(combined).toContain("prod");

		// Verify pointer file was written
		const pointerPath = path.join(tmpDir, ".xcsh", "contexts", "prod.json");
		expect(fs.existsSync(pointerPath)).toBe(true);
		const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf-8"));
		expect(pointer.context).toBe("prod");

		// Verify active_context was set
		const activeContextPath = path.join(tmpDir, ".xcsh", "contexts", "active_context");
		expect(fs.existsSync(activeContextPath)).toBe(true);
		expect(fs.readFileSync(activeContextPath, "utf-8").trim()).toBe("prod");
	});

	it("shows error when linking non-existent global context", async () => {
		ContextService.init(path.join(tmpDir, "global-config", "f5xc"));
		await handleContextCommand({ name: "context", args: "link nonexistent", text: "/context link nonexistent" }, ctx);

		const combined = output.join("\n");
		expect(combined).toContain("ERROR:");
	});

	it("shows error when no name provided", async () => {
		ContextService.init(path.join(tmpDir, "global-config", "f5xc"));
		await handleContextCommand({ name: "context", args: "link", text: "/context link" }, ctx);

		const combined = output.join("\n");
		expect(combined).toContain("ERROR:");
	});
});

describe("/context unlink", () => {
	let tmpDir: string;
	let output: string[];
	const originalEnv = { ...process.env };

	const ctx = {
		showStatus: (msg: string) => {
			output.push(msg);
		},
		showError: (msg: string) => {
			output.push(`ERROR: ${msg}`);
		},
		editor: {
			setText: (text: string) => {
				output.push(text);
			},
		},
	};

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f5xc-cmd-unlink-"));
		output = [];

		const localContextsDir = path.join(tmpDir, ".xcsh", "contexts");
		const globalConfigDir = path.join(tmpDir, "global-config", "f5xc", "contexts");
		fs.mkdirSync(localContextsDir, { recursive: true, mode: 0o700 });
		fs.mkdirSync(globalConfigDir, { recursive: true, mode: 0o700 });

		process.env.XDG_CONFIG_HOME = path.join(tmpDir, "global-config");
		delete process.env.F5XC_API_URL;
		delete process.env.F5XC_API_TOKEN;

		setProjectDir(tmpDir);
		ContextService._resetForTest();
	});

	afterEach(() => {
		ContextService._resetForTest();
		process.env = { ...originalEnv };
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("removes the pointer file and active_context", async () => {
		// Set up a linked context
		const pointerPath = path.join(tmpDir, ".xcsh", "contexts", "prod.json");
		fs.writeFileSync(pointerPath, JSON.stringify({ context: "prod" }), { mode: 0o600 });
		const activeContextPath = path.join(tmpDir, ".xcsh", "contexts", "active_context");
		fs.writeFileSync(activeContextPath, "prod");

		ContextService.init(path.join(tmpDir, "global-config", "f5xc"));
		await handleContextCommand({ name: "context", args: "unlink", text: "/context unlink" }, ctx);

		const combined = output.join("\n");
		expect(combined).not.toContain("ERROR:");

		// Verify files were removed
		expect(fs.existsSync(pointerPath)).toBe(false);
		expect(fs.existsSync(activeContextPath)).toBe(false);
	});

	it("shows error when no local active_context exists", async () => {
		ContextService.init(path.join(tmpDir, "global-config", "f5xc"));
		await handleContextCommand({ name: "context", args: "unlink", text: "/context unlink" }, ctx);

		const combined = output.join("\n");
		expect(combined).toContain("ERROR:");
	});
});
