import { afterEach, describe, expect, it } from "bun:test";
import { _resetSettingsForTest, Settings } from "@f5-sales-demo/xcsh/config/settings";
import sandboxGuard from "@f5-sales-demo/xcsh/extensibility/extensions/bundled/sandbox-guard";

const CWD = "/work/custA";

interface ToolCallEvent {
	type: "tool_call";
	toolName: string;
	toolCallId: string;
	input: Record<string, unknown>;
}
type Handler = (event: ToolCallEvent, ctx: { cwd: string }) => unknown;

/** Invoke the factory with a stub `pi` and capture its tool_call handler. */
function captureHandler(): Handler | undefined {
	let handler: Handler | undefined;
	const pi = {
		on(event: string, h: Handler) {
			if (event === "tool_call") handler = h;
		},
	};
	sandboxGuard(pi as unknown as Parameters<typeof sandboxGuard>[0]);
	return handler;
}

async function initSandbox(enabled: boolean): Promise<void> {
	_resetSettingsForTest();
	await Settings.init({ inMemory: true, cwd: CWD, overrides: { "sandbox.enabled": enabled } });
}

function call(handler: Handler, toolName: string, input: Record<string, unknown>): unknown {
	return handler({ type: "tool_call", toolName, toolCallId: "1", input }, { cwd: CWD });
}

describe("sandbox-guard bundled extension", () => {
	afterEach(() => _resetSettingsForTest());

	it("registers a tool_call handler", () => {
		expect(typeof captureHandler()).toBe("function");
	});

	it("blocks an out-of-tree read when enabled", async () => {
		await initSandbox(true);
		const handler = captureHandler()!;
		expect(await call(handler, "read", { file_path: "/work/custB/secret" })).toMatchObject({ block: true });
	});

	it("allows an in-tree read when enabled", async () => {
		await initSandbox(true);
		const handler = captureHandler()!;
		expect(await call(handler, "read", { file_path: "notes.md" })).toBeUndefined();
	});

	it("is a no-op when sandbox.enabled is false (--no-sandbox)", async () => {
		await initSandbox(false);
		const handler = captureHandler()!;
		expect(await call(handler, "read", { file_path: "/work/custB/secret" })).toBeUndefined();
	});
});
