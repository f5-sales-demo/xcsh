import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@f5xc-salesdemos/pi-utils";
import { _resetSettingsForTest, Settings } from "@f5xc-salesdemos/xcsh/config/settings";
import { ContextService, CURRENT_SCHEMA_VERSION, type F5XCContext } from "@f5xc-salesdemos/xcsh/services/f5xc-context";
import { handleContextCommand } from "@f5xc-salesdemos/xcsh/services/f5xc-context-command";
import {
	formatAuthIndicator,
	formatExpiration,
	formatRelativeTime,
	renderF5XCTable,
} from "@f5xc-salesdemos/xcsh/services/f5xc-table";
import { TEST_CONTEXT, TEST_CONTEXT_STAGING as TEST_CONTEXT_2 } from "./f5xc-test-fixtures";

describe("formatAuthIndicator", () => {
	it("includes latencyMs for offline results", () => {
		const result = formatAuthIndicator("offline", 342, "network");
		expect(result).toContain("342ms");
	});

	it("shows credential-specific text for auth_error", () => {
		const result = formatAuthIndicator("auth_error", 100, "credential");
		expect(result).toContain("check token");
	});

	it("shows network-specific text for offline", () => {
		const result = formatAuthIndicator("offline", undefined, "network");
		expect(result).toContain("network");
	});

	it("shows connected without errorClass", () => {
		const result = formatAuthIndicator("connected", 50);
		expect(result).toContain("Connected");
		expect(result).toContain("50ms");
	});
});

describe("formatRelativeTime", () => {
	const now = new Date("2026-04-23T12:00:00Z");

	it("returns 'just now' for less than 1 minute ago", () => {
		const recent = new Date(now.getTime() - 30_000).toISOString();
		expect(formatRelativeTime(recent, now)).toBe("just now");
	});

	it("returns '15 minutes ago'", () => {
		const t = new Date(now.getTime() - 15 * 60_000).toISOString();
		expect(formatRelativeTime(t, now)).toBe("15 minutes ago");
	});

	it("returns '3 hours ago'", () => {
		const t = new Date(now.getTime() - 3 * 3_600_000).toISOString();
		expect(formatRelativeTime(t, now)).toBe("3 hours ago");
	});

	it("returns '3 days ago'", () => {
		const t = new Date(now.getTime() - 3 * 86_400_000).toISOString();
		expect(formatRelativeTime(t, now)).toBe("3 days ago");
	});

	it("returns '3 months ago'", () => {
		const t = new Date(now.getTime() - 90 * 86_400_000).toISOString();
		expect(formatRelativeTime(t, now)).toBe("3 months ago");
	});

	it("uses singular '1 day ago'", () => {
		const t = new Date(now.getTime() - 1 * 86_400_000).toISOString();
		expect(formatRelativeTime(t, now)).toBe("1 day ago");
	});
});

describe("formatExpiration", () => {
	const now = new Date("2026-04-23T12:00:00Z");

	it("returns bare date string when more than 7 days away", () => {
		const future = "2026-05-10T00:00:00.000Z";
		const result = formatExpiration(future, now);
		expect(result).toBe("2026-05-10");
		expect(result).not.toContain("⚠");
		expect(result).not.toContain("expires");
	});

	it("shows warning when within 7 days", () => {
		const soon = "2026-04-28T00:00:00.000Z";
		const result = formatExpiration(soon, now);
		expect(result).toContain("expires in");
	});

	it("shows warning for today (0 days)", () => {
		const today = "2026-04-23T23:59:00.000Z";
		const result = formatExpiration(today, now);
		expect(result).toContain("expires in");
	});

	it("shows 'expired' warning for past dates", () => {
		const past = "2026-04-01T00:00:00.000Z";
		const result = formatExpiration(past, now);
		expect(result).toContain("expired");
	});

	it("uses singular '1 day' in warning", () => {
		// 20 hours after now — ceil((20h) / 24h) = 1 day
		const tomorrow = "2026-04-24T08:00:00.000Z";
		const result = formatExpiration(tomorrow, now);
		expect(result).toContain("1 day");
		expect(result).not.toMatch(/1 days/);
	});
});

describe("renderF5XCTable", () => {
	it("renders multiple labeled dividers", () => {
		const rows = [
			{ key: "A", value: "1" },
			{ key: "B", value: "2" },
			{ key: "C", value: "3" },
			{ key: "D", value: "4" },
		];
		const result = renderF5XCTable("test", rows, {
			dividers: [
				{ before: 2, label: "Section Two" },
				{ before: 3, label: "Section Three" },
			],
		});
		const plain = result.replace(/\x1b\[[0-9;]*m/g, "");
		expect(plain).toContain("Section Two");
		expect(plain).toContain("Section Three");
	});

	it("renders with no dividers (backwards compatible)", () => {
		const rows = [{ key: "A", value: "1" }];
		const result = renderF5XCTable("test", rows);
		expect(result).toContain("A");
		expect(result).not.toContain("Environment");
	});
});

function writeContext(
	contextsDir: string,
	context: { name: string; apiUrl: string; apiToken: string; defaultNamespace: string },
): void {
	fs.mkdirSync(contextsDir, { recursive: true });
	fs.writeFileSync(path.join(contextsDir, `${context.name}.json`), JSON.stringify(context, null, 2), { mode: 0o600 });
}

function writeActiveContext(configDir: string, name: string): void {
	fs.writeFileSync(path.join(configDir, "active_context"), name);
}

/** Minimal mock of InteractiveModeContext for slash command testing */
function createMockCtx() {
	const messages: { type: string; text: string }[] = [];
	const calls = { invalidate: 0, updateEditorTopBorder: 0, requestRender: 0 };
	return {
		messages,
		calls,
		showStatus(msg: string, _options?: { dim?: boolean }) {
			messages.push({ type: "status", text: msg });
		},
		showError(msg: string) {
			messages.push({ type: "error", text: msg });
		},
		showWarning(msg: string) {
			messages.push({ type: "warning", text: msg });
		},
		editor: { setText(_text: string) {} },
		statusLine: {
			invalidate() {
				calls.invalidate += 1;
			},
		},
		updateEditorTopBorder() {
			calls.updateEditorTopBorder += 1;
		},
		ui: {
			requestRender() {
				calls.requestRender += 1;
			},
		},
	};
}

describe("/context slash command handler", () => {
	let testDir: string;
	let f5xcConfigDir: string;
	let f5xcContextsDir: string;
	let projectDir: string;
	let agentDir: string;

	beforeEach(async () => {
		_resetSettingsForTest();
		ContextService._resetForTest();
		// Ensure F5XC env vars don't leak from system environment
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("F5XC_")) delete process.env[key];
		}

		testDir = path.join(os.tmpdir(), "test-f5xc-cmd", Snowflake.next());
		f5xcConfigDir = path.join(testDir, "f5xc-config");
		f5xcContextsDir = path.join(f5xcConfigDir, "contexts");
		projectDir = path.join(testDir, "project");
		agentDir = path.join(testDir, "agent");

		fs.mkdirSync(projectDir, { recursive: true });
		fs.mkdirSync(path.join(projectDir, ".xcsh"), { recursive: true });
		fs.mkdirSync(agentDir, { recursive: true });

		await Settings.init({ cwd: projectDir, agentDir, inMemory: true });
	});

	afterEach(() => {
		_resetSettingsForTest();
		ContextService._resetForTest();
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("F5XC_")) delete process.env[key];
		}
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	it("/context list shows contexts with active marker", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		writeContext(f5xcContextsDir, TEST_CONTEXT_2);
		writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);

		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();

		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "list", text: "/context list" }, ctx);

		expect(ctx.messages.length).toBe(1);
		expect(ctx.messages[0].type).toBe("status");
		const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
		expect(plain).toContain("contexts");
		expect(plain).toContain("✅");
		expect(plain).toContain("production");
		expect(plain).toContain("staging");
	});

	it("/context list shows helpful message when no contexts", async () => {
		ContextService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "list", text: "/context list" }, ctx);

		expect(ctx.messages[0].type).toBe("status");
		const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
		expect(plain).toContain("contexts");
		expect(plain).toContain("No F5 XC contexts found");
	});

	it("/context list shows env-only entry when F5XC_API_URL is set", async () => {
		process.env.F5XC_API_URL = "https://acme.console.ves.volterra.io";
		process.env.F5XC_API_TOKEN = "FAKE-TOKEN";
		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();

		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "list", text: "/context list" }, ctx);

		expect(ctx.messages[0].type).toBe("status");
		const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
		expect(plain).toContain("contexts");
		expect(plain).toContain("acme");
		expect(plain).toContain("via env vars");
	});

	it("/context activate switches context", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		writeContext(f5xcContextsDir, TEST_CONTEXT_2);
		writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);

		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();

		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "activate staging", text: "/context activate staging" }, ctx);

		expect(ctx.messages[0].type).toBe("status");
		// Activate now shows the same red table as /context show
		const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
		expect(plain).toContain("staging");
		expect(plain).toContain("F5XC_TENANT");

		const bashEnv = Settings.instance.get("bash.environment") as Record<string, string>;
		expect(bashEnv.F5XC_API_URL).toBe(TEST_CONTEXT_2.apiUrl);
	});

	it("/context activate with no arg shows error", async () => {
		ContextService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "activate", text: "/context activate" }, ctx);

		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("Usage");
	});

	it("/context show displays masked token", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);

		const service = ContextService.init(f5xcConfigDir);
		const loaded = await service.loadActive();
		expect(loaded).not.toBeNull(); // Ensure context actually loaded

		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "show", text: "/context show" }, ctx);

		expect(ctx.messages[0].type).toBe("status");
		expect(ctx.messages[0].text).toContain(`...${TEST_CONTEXT.apiToken.slice(-4)}`);
		// Full token must NEVER appear in output
		expect(ctx.messages[0].text).not.toContain(TEST_CONTEXT.apiToken);
	});

	it("/context status shows auth status", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);

		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();

		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "status", text: "/context status" }, ctx);

		expect(ctx.messages[0].type).toBe("status");
		expect(ctx.messages[0].text).toContain("production");
		expect(ctx.messages[0].text).toContain("context");
	});

	// --- /context create ---

	it("/context create with valid args creates context and shows success", async () => {
		ContextService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleContextCommand(
			{
				name: "context",
				args: "create myprof https://t.console.ves.volterra.io tok-secret staging-ns",
				text: "/context create ...",
			},
			ctx,
		);

		expect(ctx.messages[0].type).toBe("status");
		const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
		expect(plain).toContain("myprof");
		expect(plain).toContain("Created");
		// Context file should exist on disk
		expect(fs.existsSync(path.join(f5xcContextsDir, "myprof.json"))).toBe(true);
	});

	it("/context create defaults namespace to 'default' when omitted", async () => {
		ContextService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleContextCommand(
			{
				name: "context",
				args: "create myprof https://t.console.ves.volterra.io tok-secret",
				text: "/context create ...",
			},
			ctx,
		);

		expect(ctx.messages[0].type).toBe("status");
		const data = JSON.parse(fs.readFileSync(path.join(f5xcContextsDir, "myprof.json"), "utf-8"));
		expect(data.defaultNamespace).toBe("default");
	});

	it("/context create with missing args shows usage error", async () => {
		ContextService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "create myprof", text: "/context create myprof" }, ctx);

		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("Usage");
	});

	it("/context create with invalid context name shows error", async () => {
		ContextService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleContextCommand(
			{
				name: "context",
				args: "create ../../bad https://t.console.ves.volterra.io tok",
				text: "/context create ...",
			},
			ctx,
		);

		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("alphanumeric");
	});

	it("/context create with HTTP URL (not HTTPS) shows error", async () => {
		ContextService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleContextCommand(
			{ name: "context", args: "create valid http://insecure.example.com tok", text: "/context create ..." },
			ctx,
		);

		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("HTTPS");
	});

	it("/context create with invalid URL shows error", async () => {
		ContextService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleContextCommand(
			{ name: "context", args: "create valid not-a-url tok", text: "/context create ..." },
			ctx,
		);

		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("HTTPS");
	});

	it("/context create with duplicate name shows error", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		ContextService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleContextCommand(
			{
				name: "context",
				args: `create ${TEST_CONTEXT.name} https://t.console.ves.volterra.io tok`,
				text: "/context create ...",
			},
			ctx,
		);

		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("already exists");
	});

	it("/context create success output never contains raw token", async () => {
		const secretToken = "super-secret-token-value-12345";
		ContextService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleContextCommand(
			{
				name: "context",
				args: `create myprof https://t.console.ves.volterra.io ${secretToken}`,
				text: "/context create ...",
			},
			ctx,
		);

		expect(ctx.messages[0].type).toBe("status");
		expect(ctx.messages[0].text).not.toContain(secretToken);
	});

	// --- /context delete ---

	it("/context delete with --confirm deletes context and shows success", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		writeContext(f5xcContextsDir, TEST_CONTEXT_2);
		writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);

		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();

		const ctx = createMockCtx();
		await handleContextCommand(
			{ name: "context", args: "delete staging --confirm", text: "/context delete staging --confirm" },
			ctx,
		);

		expect(ctx.messages[0].type).toBe("status");
		const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
		expect(plain).toContain("staging");
		expect(plain).toContain("Deleted");
		expect(fs.existsSync(path.join(f5xcContextsDir, "staging.json"))).toBe(false);
	});

	it("/context delete without --confirm shows confirmation prompt", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		writeContext(f5xcContextsDir, TEST_CONTEXT_2);
		writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);

		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();

		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "delete staging", text: "/context delete staging" }, ctx);

		expect(ctx.messages[0].type).toBe("status");
		const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
		expect(plain).toContain("staging");
		expect(plain).toContain("--confirm");
		expect(fs.existsSync(path.join(f5xcContextsDir, "staging.json"))).toBe(true);
	});

	it("/context delete with no name shows usage error", async () => {
		ContextService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "delete", text: "/context delete" }, ctx);

		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("Usage");
	});

	it("/context delete prevents deleting the active context", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);

		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();

		const ctx = createMockCtx();
		await handleContextCommand(
			{
				name: "context",
				args: `delete ${TEST_CONTEXT.name} --confirm`,
				text: "/context delete production --confirm",
			},
			ctx,
		);

		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("Cannot delete the active context");
	});

	it("/context delete non-existent context with --confirm shows error", async () => {
		ContextService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleContextCommand(
			{ name: "context", args: "delete ghost --confirm", text: "/context delete ghost --confirm" },
			ctx,
		);

		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("not found");
	});

	it("/context (no subcommand) defaults to list", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);

		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();

		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "", text: "/context" }, ctx);

		expect(ctx.messages[0].type).toBe("status");
		const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
		expect(plain).toContain("contexts");
		expect(plain).toContain("production");
	});

	// --- /context namespace ---

	it("/context namespace switches namespace and shows confirmation", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);

		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();

		const ctx = createMockCtx();
		await handleContextCommand(
			{ name: "context", args: "namespace other-ns", text: "/context namespace other-ns" },
			ctx,
		);

		expect(ctx.messages[0].type).toBe("status");
		const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
		expect(plain).toContain("namespace");
		expect(plain).toContain("other-ns");
		expect(service.getStatus().activeContextNamespace).toBe("other-ns");
	});

	it("/context namespace with no arg shows usage", async () => {
		ContextService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "namespace", text: "/context namespace" }, ctx);

		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("Usage");
	});

	it("/context unknown shows not-found error with create suggestion (dispatch refactor)", async () => {
		ContextService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "banana", text: "/context banana" }, ctx);

		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("not found");
		expect(ctx.messages[0].text).toContain("/context create banana");
	});

	it("/context list shows version warning suffix for incompatible contexts", async () => {
		fs.mkdirSync(f5xcContextsDir, { recursive: true });
		fs.writeFileSync(
			path.join(f5xcContextsDir, "future.json"),
			JSON.stringify(
				{
					name: "future",
					apiUrl: "https://example.console.ves.volterra.io",
					apiToken: "tok",
					defaultNamespace: "default",
					version: CURRENT_SCHEMA_VERSION + 1,
				},
				null,
				2,
			),
			{ mode: 0o600 },
		);

		ContextService.init(f5xcConfigDir);

		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "list", text: "/context list" }, ctx);

		expect(ctx.messages[0].type).toBe("status");
		const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
		expect(plain).toContain("contexts");
		expect(plain).toContain("future");
		expect(plain).toContain("upgrade required");
	});

	describe("error message actionability", () => {
		it("/context activate with no name shows usage with /context list hint", async () => {
			ContextService.init(f5xcConfigDir);
			const ctx = createMockCtx();
			await handleContextCommand({ name: "context", args: "activate", text: "/context activate" }, ctx);
			expect(ctx.messages[0].type).toBe("error");
			expect(ctx.messages[0].text).toContain("/context list");
		});

		it("/context show with no active context shows create/activate hint", async () => {
			ContextService.init(f5xcConfigDir);
			const ctx = createMockCtx();
			await handleContextCommand({ name: "context", args: "show", text: "/context show" }, ctx);
			expect(ctx.messages[0].type).toBe("error");
			expect(ctx.messages[0].text).toContain("/context create");
			expect(ctx.messages[0].text).toContain("/context activate");
		});

		it("/context show with unknown context name shows /context list hint", async () => {
			ContextService.init(f5xcConfigDir);
			const ctx = createMockCtx();
			await handleContextCommand({ name: "context", args: "show ghost", text: "/context show ghost" }, ctx);
			expect(ctx.messages[0].type).toBe("error");
			expect(ctx.messages[0].text).toContain("ghost");
			expect(ctx.messages[0].text).toContain("/context list");
		});

		it("/context delete active context shows activate-other hint", async () => {
			writeContext(f5xcContextsDir, TEST_CONTEXT);
			writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);
			const service = ContextService.init(f5xcConfigDir);
			await service.loadActive();
			const ctx = createMockCtx();
			await handleContextCommand(
				{
					name: "context",
					args: `delete ${TEST_CONTEXT.name} --confirm`,
					text: "/context delete production --confirm",
				},
				ctx,
			);
			expect(ctx.messages[0].type).toBe("error");
			expect(ctx.messages[0].text).toContain("/context activate");
		});
	});

	// --- /context show metadata display ---

	describe("/context show metadata display", () => {
		it("shows metadata section when context has metadata", async () => {
			const metaContext = {
				name: "meta-test",
				apiUrl: TEST_CONTEXT.apiUrl,
				apiToken: TEST_CONTEXT.apiToken,
				defaultNamespace: TEST_CONTEXT.defaultNamespace,
				metadata: {
					createdAt: "2026-01-01T00:00:00.000Z",
					expiresAt: "2027-06-01T00:00:00.000Z",
					lastRotatedAt: "2026-03-01T00:00:00.000Z",
					rotateAfterDays: 90,
				},
			};
			writeContext(f5xcContextsDir, metaContext);
			writeActiveContext(f5xcConfigDir, "meta-test");

			const service = ContextService.init(f5xcConfigDir);
			await service.loadActive();

			const ctx = createMockCtx();
			await handleContextCommand({ name: "context", args: "show", text: "/context show" }, ctx);

			const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
			expect(plain).toContain("Metadata");
			expect(plain).toContain("Created");
			expect(plain).toContain("Expires");
			expect(plain).toContain("Last Rotated");
			expect(plain).toContain("every 90 days");
		});

		it("does not show metadata section when context has no metadata", async () => {
			writeContext(f5xcContextsDir, TEST_CONTEXT);
			writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);

			const service = ContextService.init(f5xcConfigDir);
			await service.loadActive();

			const ctx = createMockCtx();
			await handleContextCommand({ name: "context", args: "show", text: "/context show" }, ctx);

			const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
			expect(plain).not.toContain("Metadata");
			expect(plain).not.toContain("Created");
		});

		it("shows only createdAt when that is the only metadata field", async () => {
			const minMetaContext = {
				name: "min-meta",
				apiUrl: TEST_CONTEXT.apiUrl,
				apiToken: TEST_CONTEXT.apiToken,
				defaultNamespace: TEST_CONTEXT.defaultNamespace,
				metadata: { createdAt: "2026-01-01T00:00:00.000Z" },
			};
			writeContext(f5xcContextsDir, minMetaContext);
			writeActiveContext(f5xcConfigDir, "min-meta");

			const service = ContextService.init(f5xcConfigDir);
			await service.loadActive();

			const ctx = createMockCtx();
			await handleContextCommand({ name: "context", args: "show", text: "/context show" }, ctx);

			const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
			expect(plain).toContain("Metadata");
			expect(plain).toContain("Created");
			expect(plain).not.toContain("Expires");
			expect(plain).not.toContain("Last Rotated");
		});
	});

	// --- /context validate ---

	it("/context validate with no arg shows error pointing at /context status", async () => {
		ContextService.init(f5xcConfigDir);
		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "validate", text: "/context validate" }, ctx);
		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("Usage: /context validate <name>");
		expect(ctx.messages[0].text).toContain("/context status");
	});

	it("/context validate <name> renders a validation-only table for an existing context", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		const savedFetch = globalThis.fetch;
		globalThis.fetch = (() =>
			Promise.resolve(new Response("ok", { status: 200 }))) as unknown as typeof globalThis.fetch;
		try {
			ContextService.init(f5xcConfigDir);
			const ctx = createMockCtx();
			await handleContextCommand(
				{ name: "context", args: `validate ${TEST_CONTEXT.name}`, text: `/context validate ${TEST_CONTEXT.name}` },
				ctx,
			);
			expect(ctx.messages[0].type).toBe("status");
			const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
			expect(plain).toContain(TEST_CONTEXT.name);
			expect(plain).toContain("validation only");
			expect(plain).toContain("F5XC_API_URL");
			expect(plain).toContain("F5XC_API_TOKEN");
			expect(plain).toContain(`...${TEST_CONTEXT.apiToken.slice(-4)}`);
		} finally {
			globalThis.fetch = savedFetch;
		}
	});

	it("/context validate <missing> surfaces ContextError via showError", async () => {
		ContextService.init(f5xcConfigDir);
		const ctx = createMockCtx();
		await handleContextCommand(
			{ name: "context", args: "validate nonexistent", text: "/context validate nonexistent" },
			ctx,
		);
		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toMatch(/not found/i);
	});

	it("/context rename with no args shows error", async () => {
		ContextService.init(f5xcConfigDir);
		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "rename", text: "/context rename" }, ctx);
		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("Usage");
	});

	it("/context rename <old> with only one arg shows error", async () => {
		ContextService.init(f5xcConfigDir);
		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "rename onlyone", text: "/context rename onlyone" }, ctx);
		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("Usage");
	});

	it("/context rename <old> <new> renames and reports success", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();
		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: `rename ${TEST_CONTEXT.name} prod-new`, text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("status");
		const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
		expect(plain).toContain("prod-new");
		expect(plain).toContain("Renamed");
	});

	it("/context rename surfaces ContextError when target exists", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		writeContext(f5xcContextsDir, TEST_CONTEXT_2);
		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();
		const ctx = createMockCtx();
		await handleContextCommand(
			{ name: "context", args: `rename ${TEST_CONTEXT.name} ${TEST_CONTEXT_2.name}`, text: "" },
			ctx,
		);
		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toMatch(/already exists/);
	});

	it("/context export emits a masked bundle by default", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();
		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "export", text: "/context export" }, ctx);
		expect(ctx.messages[0].type).toBe("status");
		const parsed = JSON.parse(ctx.messages[0].text);
		expect(parsed.version).toBe(1);
		expect(parsed.tokensMasked).toBe(true);
		expect(parsed.contexts[0].apiToken.startsWith("...")).toBe(true);
	});

	it("/context export <name> filters to one context", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		writeContext(f5xcContextsDir, TEST_CONTEXT_2);
		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();
		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: `export ${TEST_CONTEXT.name}`, text: "" }, ctx);
		const parsed = JSON.parse(ctx.messages[0].text);
		expect(parsed.contexts.length).toBe(1);
		expect(parsed.contexts[0].name).toBe(TEST_CONTEXT.name);
	});

	it("/context export does not misparse a leading-dash context name as a flag", async () => {
		// Regression: context names allow leading dashes (/^[a-zA-Z0-9_-]{1,64}$/).
		// `/context export --prod` used to send everything to flags, leaving
		// zero positionals — which fell through to "export all contexts".
		// Combined with --include-token it would dump every token unmasked.
		// After the fix, splitArgs recognizes only the known --include-token
		// flag; anything else stays in positionals.
		const prefixedContext: F5XCContext = { ...TEST_CONTEXT, name: "--prod" };
		writeContext(f5xcContextsDir, prefixedContext);
		writeContext(f5xcContextsDir, TEST_CONTEXT_2);
		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();
		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "export --prod", text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("status");
		const parsed = JSON.parse(ctx.messages[0].text);
		expect(parsed.contexts.length).toBe(1);
		expect(parsed.contexts[0].name).toBe("--prod");
	});

	it("/context export --prod --include-token still honors the flag and filters to one context", async () => {
		const prefixedContext: F5XCContext = { ...TEST_CONTEXT, name: "--prod" };
		writeContext(f5xcContextsDir, prefixedContext);
		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();
		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "export --prod --include-token", text: "" }, ctx);
		const parsed = JSON.parse(ctx.messages[0].text);
		expect(parsed.contexts.length).toBe(1);
		expect(parsed.contexts[0].name).toBe("--prod");
		expect(parsed.tokensMasked).toBe(false);
		expect(parsed.contexts[0].apiToken).toBe(prefixedContext.apiToken);
	});

	it("/context export --include-token emits unmasked tokens", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();
		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "export --include-token", text: "" }, ctx);
		const parsed = JSON.parse(ctx.messages[0].text);
		expect(parsed.tokensMasked).toBe(false);
		expect(parsed.contexts[0].apiToken).toBe(TEST_CONTEXT.apiToken);
	});

	it("/context export surfaces not-found errors", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();
		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "export nonexistent", text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toMatch(/not found/);
	});

	it("/context import with no arg shows usage error", async () => {
		ContextService.init(f5xcConfigDir);
		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "import", text: "/context import" }, ctx);
		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("Usage: /context import");
	});

	it("/context import <path> imports from a file", async () => {
		const bundlePath = path.join(testDir, "bundle.json");
		fs.writeFileSync(
			bundlePath,
			JSON.stringify({
				version: 1,
				exportedAt: new Date().toISOString(),
				tokensMasked: false,
				contexts: [TEST_CONTEXT],
			}),
		);
		ContextService.init(f5xcConfigDir);
		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: `import ${bundlePath}`, text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("status");
		const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
		expect(plain).toContain("import");
		expect(plain).toMatch(/imported/i);
		expect(fs.existsSync(path.join(f5xcContextsDir, `${TEST_CONTEXT.name}.json`))).toBe(true);
	});

	it("/context import {inline JSON} parses inline", async () => {
		const inline = JSON.stringify({
			version: 1,
			exportedAt: "",
			tokensMasked: false,
			contexts: [TEST_CONTEXT],
		});
		ContextService.init(f5xcConfigDir);
		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: `import ${inline}`, text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("status");
		expect(fs.existsSync(path.join(f5xcContextsDir, `${TEST_CONTEXT.name}.json`))).toBe(true);
	});

	it("/context import ~/file expands tilde", async () => {
		const savedHome = process.env.HOME;
		process.env.HOME = testDir;
		try {
			const bundlePath = path.join(testDir, "bundle.json");
			fs.writeFileSync(
				bundlePath,
				JSON.stringify({
					version: 1,
					exportedAt: "",
					tokensMasked: false,
					contexts: [TEST_CONTEXT],
				}),
			);
			ContextService.init(f5xcConfigDir);
			const ctx = createMockCtx();
			await handleContextCommand({ name: "context", args: "import ~/bundle.json", text: "" }, ctx);
			expect(ctx.messages[0].type).toBe("status");
		} finally {
			if (savedHome === undefined) delete process.env.HOME;
			else process.env.HOME = savedHome;
		}
	});

	it("/context import surfaces conflict error without --overwrite", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();
		const inline = JSON.stringify({
			version: 1,
			exportedAt: "",
			tokensMasked: false,
			contexts: [TEST_CONTEXT],
		});
		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: `import ${inline}`, text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toMatch(/conflict/i);
	});

	it("/context import --overwrite replaces conflicting contexts", async () => {
		writeContext(f5xcContextsDir, { ...TEST_CONTEXT, defaultNamespace: "old" });
		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();
		const inline = JSON.stringify({
			version: 1,
			exportedAt: "",
			tokensMasked: false,
			contexts: [{ ...TEST_CONTEXT, defaultNamespace: "new" }],
		});
		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: `import ${inline} --overwrite`, text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("status");
		const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
		expect(plain).toMatch(/overwrote/i);
	});

	it("/context import --overwrite refreshes TUI chrome when the active context is touched", async () => {
		// Regression: importContexts re-activates the active context when an
		// overwrite touches it, mutating #activeContext, bash.environment, and
		// cached auth. Without invalidating statusLine + updateEditorTopBorder
		// + ui.requestRender, the TUI's context chrome advertises the old
		// tenant until an unrelated command triggers a refresh.
		writeContext(f5xcContextsDir, { ...TEST_CONTEXT, defaultNamespace: "old" });
		writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);
		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();
		const inline = JSON.stringify({
			version: 1,
			exportedAt: "",
			tokensMasked: false,
			contexts: [{ ...TEST_CONTEXT, defaultNamespace: "new" }],
		});
		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: `import ${inline} --overwrite`, text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("status");
		expect(ctx.calls.invalidate).toBeGreaterThanOrEqual(1);
		expect(ctx.calls.updateEditorTopBorder).toBeGreaterThanOrEqual(1);
		expect(ctx.calls.requestRender).toBeGreaterThanOrEqual(1);
	});

	it("/context import --overwrite does NOT refresh TUI chrome when the active context is untouched", async () => {
		// Symmetric guard: importing a new name (or overwriting a non-active
		// context) must not invalidate the chrome — matches the handleCreate /
		// handleExport no-op pattern.
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);
		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();
		// Overwrite the *staging* context — active is production.
		writeContext(f5xcContextsDir, { ...TEST_CONTEXT_2, defaultNamespace: "original" });
		const inline = JSON.stringify({
			version: 1,
			exportedAt: "",
			tokensMasked: false,
			contexts: [{ ...TEST_CONTEXT_2, defaultNamespace: "replaced" }],
		});
		const ctx = createMockCtx();
		// Reset the service's cache so the fresh listContexts sees staging too
		await service.listContexts();
		await handleContextCommand({ name: "context", args: `import ${inline} --overwrite`, text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("status");
		expect(ctx.calls.invalidate).toBe(0);
		expect(ctx.calls.updateEditorTopBorder).toBe(0);
		expect(ctx.calls.requestRender).toBe(0);
	});

	it("/context import rejects masked bundle", async () => {
		const inline = JSON.stringify({
			version: 1,
			exportedAt: "",
			tokensMasked: true,
			contexts: [{ ...TEST_CONTEXT, apiToken: "...g7h8" }],
		});
		ContextService.init(f5xcConfigDir);
		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: `import ${inline}`, text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toMatch(/masked tokens/i);
	});

	it("/context import reports unreadable path cleanly", async () => {
		ContextService.init(f5xcConfigDir);
		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "import /nonexistent/nope.json", text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toMatch(/not found|no such/i);
	});

	it("/context import reports non-JSON file cleanly", async () => {
		const bundlePath = path.join(testDir, "garbage.json");
		fs.writeFileSync(bundlePath, "not actually json");
		ContextService.init(f5xcConfigDir);
		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: `import ${bundlePath}`, text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toMatch(/not valid JSON|missing required fields/i);
	});

	it("/context import preserves whitespace runs inside inline JSON string values", async () => {
		// Regression: prior implementation tokenized args on /\s+/ and rejoined
		// with single spaces, collapsing multi-space runs inside string values.
		// A token/password like "foo   bar" would become "foo bar" before JSON.parse,
		// importing a corrupted credential.
		const weirdToken = "token\twith   embedded\t\twhitespace";
		const contextWithWhitespace = {
			...TEST_CONTEXT,
			apiToken: weirdToken,
		};
		const inline = JSON.stringify({
			version: 1,
			exportedAt: "",
			tokensMasked: false,
			contexts: [contextWithWhitespace],
		});
		ContextService.init(f5xcConfigDir);
		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: `import ${inline}`, text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("status");
		// The imported context on disk must have the original token bytes intact.
		const onDiskPath = path.join(f5xcContextsDir, `${TEST_CONTEXT.name}.json`);
		const onDisk = JSON.parse(fs.readFileSync(onDiskPath, "utf-8"));
		expect(onDisk.apiToken).toBe(weirdToken);
	});

	it("/context import accepts --overwrite as a leading flag", async () => {
		writeContext(f5xcContextsDir, { ...TEST_CONTEXT, defaultNamespace: "original" });
		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();
		const inline = JSON.stringify({
			version: 1,
			exportedAt: "",
			tokensMasked: false,
			contexts: [{ ...TEST_CONTEXT, defaultNamespace: "new" }],
		});
		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: `import --overwrite ${inline}`, text: "" }, ctx);
		expect(ctx.messages[0].type).toBe("status");
		const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
		expect(plain).toMatch(/overwrote/i);
	});

	it("/context <name> directly switches to a named context", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		writeContext(f5xcContextsDir, TEST_CONTEXT_2);
		writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);

		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();

		const ctx = createMockCtx();
		await handleContextCommand(
			{ name: "context", args: TEST_CONTEXT_2.name, text: `/context ${TEST_CONTEXT_2.name}` },
			ctx,
		);

		expect(ctx.messages.length).toBeGreaterThanOrEqual(1);
		expect(ctx.messages[0].type).toBe("status");
		expect(ctx.calls.invalidate).toBeGreaterThan(0);
	});

	it("/context <nonexistent> shows error with create suggestion", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);

		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();

		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "nonexistent", text: "/context nonexistent" }, ctx);

		expect(ctx.messages.length).toBe(1);
		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("not found");
		expect(ctx.messages[0].text).toContain("/context create nonexistent");
	});

	it("/context - switches to previous context", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		writeContext(f5xcContextsDir, TEST_CONTEXT_2);
		writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);

		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();
		await service.activate(TEST_CONTEXT_2.name);

		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "-", text: "/context -" }, ctx);

		expect(ctx.messages.length).toBeGreaterThanOrEqual(1);
		expect(ctx.messages[0].type).toBe("status");
		expect(service.getStatus().activeContextName).toBe(TEST_CONTEXT.name);
		expect(ctx.calls.invalidate).toBeGreaterThan(0);
	});

	it("/context - with no previous shows error", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);

		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();

		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "-", text: "/context -" }, ctx);

		expect(ctx.messages.length).toBe(1);
		expect(ctx.messages[0].type).toBe("error");
		expect(ctx.messages[0].text).toContain("No previous context");
	});

	it("/context list still works after dispatch refactor (regression)", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);

		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();

		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "list", text: "/context list" }, ctx);

		expect(ctx.messages.length).toBe(1);
		expect(ctx.messages[0].type).toBe("status");
		const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
		expect(plain).toContain("contexts");
		expect(plain).toContain("production");
	});

	it("/context (bare) still lists contexts (regression)", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);

		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();

		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "", text: "/context" }, ctx);

		expect(ctx.messages.length).toBe(1);
		expect(ctx.messages[0].type).toBe("status");
		const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
		expect(plain).toContain("contexts");
		expect(plain).toContain("production");
	});

	it("/context KEY=VALUE still sets env vars (regression)", async () => {
		writeContext(f5xcContextsDir, TEST_CONTEXT);
		writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);

		const service = ContextService.init(f5xcConfigDir);
		await service.loadActive();

		const ctx = createMockCtx();
		await handleContextCommand({ name: "context", args: "MY_VAR=hello", text: "/context MY_VAR=hello" }, ctx);

		expect(ctx.messages.length).toBe(1);
		expect(ctx.messages[0].type).toBe("status");
		const plain = ctx.messages[0].text.replace(/\x1b\[[0-9;]*m/g, "");
		expect(plain).toContain("MY_VAR");
	});

	describe("/context set reserved key enforcement", () => {
		it("/context set F5XC_NAMESPACE=x shows rejection message", async () => {
			writeContext(f5xcContextsDir, TEST_CONTEXT);
			writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);

			const service = ContextService.init(f5xcConfigDir);
			await service.loadActive();

			const ctx = createMockCtx();
			await handleContextCommand(
				{ name: "context", args: "set F5XC_NAMESPACE=my-ns", text: "/context set F5XC_NAMESPACE=my-ns" },
				ctx,
			);
			expect(ctx.messages[0].type).toBe("error");
			expect(ctx.messages[0].text).toContain("F5XC_NAMESPACE");
			expect(ctx.messages[0].text).toContain("/context namespace");
		});

		it("/context set with multiple reserved keys shows all violations in one error", async () => {
			writeContext(f5xcContextsDir, TEST_CONTEXT);
			writeActiveContext(f5xcConfigDir, TEST_CONTEXT.name);

			const service = ContextService.init(f5xcConfigDir);
			await service.loadActive();

			const ctx = createMockCtx();
			await handleContextCommand(
				{
					name: "context",
					args: "set F5XC_NAMESPACE=x F5XC_API_URL=y",
					text: "/context set F5XC_NAMESPACE=x F5XC_API_URL=y",
				},
				ctx,
			);
			expect(ctx.messages[0].type).toBe("error");
			expect(ctx.messages[0].text).toContain("F5XC_NAMESPACE");
			expect(ctx.messages[0].text).toContain("F5XC_API_URL");
		});
	});
});
