import { afterEach, describe, expect, it } from "bun:test";
import { _resetSettingsForTest, Settings, settings } from "@f5-sales-demo/xcsh/config/settings";
import sandboxGuard from "@f5-sales-demo/xcsh/extensibility/extensions/bundled/sandbox-guard";
import { containmentStatus } from "@f5-sales-demo/xcsh/sandbox/containment";

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

	it("honors a MID-SESSION allowRead grant (settings.override busts the policy cache)", async () => {
		await initSandbox(true);
		const handler = captureHandler()!;
		// First call caches the policy; the path is out-of-tree → blocked.
		expect(await call(handler, "read", { file_path: "/work/custB/secret" })).toMatchObject({ block: true });
		// The user grants /work/custB at runtime (e.g. the Office pane picks a context
		// folder). A cwd-only cache would keep blocking; the allow-list-keyed cache rebuilds.
		settings.override("sandbox.allowRead", ["/work/custB"]);
		expect(await call(handler, "read", { file_path: "/work/custB/secret" })).toBeUndefined();
		// Revoking it re-blocks (cache tracks the current allow-list, not a one-way widen).
		settings.override("sandbox.allowRead", []);
		expect(await call(handler, "read", { file_path: "/work/custB/secret" })).toMatchObject({ block: true });
	});
	/**
	 * #2582, at the layer that actually shipped the divergence.
	 *
	 * The guard is what refused a `/tmp` write and a `~/.gitconfig` read on v19.100.0 — operations the
	 * fence permits and `xcsh://about` promises. It now asks whether an OS backend is confining the
	 * shell, and stands aside for `bash` when one is. Keyed off the product's own
	 * `containmentStatus(true).osEnforced` rather than a platform check written here, so this test and
	 * the shipped behaviour cannot drift apart.
	 */
	describe("bash and the OS fence (#2582)", () => {
		const osEnforced = containmentStatus(true).osEnforced;

		it(`${osEnforced ? "defers to the fence" : "is the boundary"} for a bash command naming a reachable path`, async () => {
			await initSandbox(true);
			const handler = captureHandler()!;
			// The fence permits both of these; the scan refused both.
			for (const command of ["printf x > /tmp/xcsh-guard-probe.txt", "cat /etc/hosts"]) {
				const decision = await call(handler, "bash", { command });
				if (osEnforced) expect(decision).toBeUndefined();
				else expect(decision).toMatchObject({ block: true });
			}
		});

		it("never stands aside for python, which no fence covers", async () => {
			await initSandbox(true);
			const handler = captureHandler()!;
			expect(await call(handler, "python", { code: "open('/work/custB/secret').read()" })).toMatchObject({
				block: true,
			});
		});

		it("never stands aside for the structured file tools", async () => {
			await initSandbox(true);
			const handler = captureHandler()!;
			expect(await call(handler, "read", { file_path: "/work/custB/secret" })).toMatchObject({ block: true });
			expect(await call(handler, "write", { file_path: "/work/custB/planted" })).toMatchObject({ block: true });
		});
	});
});
