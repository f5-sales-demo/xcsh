import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { AssistantMessage, ToolCall } from "@f5-sales-demo/pi-ai";
import { Container } from "@f5-sales-demo/pi-tui";
import { _resetSettingsForTest, Settings } from "../../../src/config/settings";
import { DisposableContainer, GutterBlock } from "../../../src/modes/components/gutter-block";
import { EventController } from "../../../src/modes/controllers/event-controller";
import { initTheme } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";
import type { AgentSessionEvent } from "../../../src/session/agent-session";

function call(id: string, name = "xcsh_context"): ToolCall {
	return { type: "toolCall", id, name, arguments: name === "read" ? { path: `${id}.txt` } : { action: "status" } };
}

function message(calls: ToolCall[]): AssistantMessage {
	return {
		role: "assistant",
		content: calls,
		api: "openai-codex-responses",
		provider: "openai-codex",
		model: "gpt-6.1-sol",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: Date.now(),
	};
}

function fixture() {
	const chat = new DisposableContainer();
	const pending = new Map();
	const context = {
		isInitialized: true,
		isBackgrounded: false,
		chatContainer: chat,
		pendingTools: pending,
		ui: { requestRender: vi.fn() },
		statusContainer: new Container(),
		statusLine: { invalidate: vi.fn() },
		updateEditorTopBorder: vi.fn(),
		ensureLoadingAnimation: vi.fn(),
		flushPendingModelSwitch: async () => {},
		editor: { getText: () => "" },
		sessionManager: { getCwd: () => "/test-project", getSessionName: () => undefined },
		session: {
			getToolByName: (name: string) => ({ name, label: name === "xcsh_context" ? "Tenant context" : name }),
			isTtsrAbortPending: false,
		},
	} as unknown as InteractiveModeContext;
	const controller = new EventController(context);
	return { controller, context, chat, pending };
}

type Fixture = ReturnType<typeof fixture>;
const fixtures: Fixture[] = [];

async function start(f: Fixture, calls: ToolCall[]) {
	await f.controller.handleEvent({ type: "message_start", message: message(calls) });
	await update(f, calls);
}

async function update(f: Fixture, calls: ToolCall[]) {
	const partial = message(calls);
	await f.controller.handleEvent({
		type: "message_update",
		message: partial,
		assistantMessageEvent: { type: "toolcall_delta", contentIndex: calls.length - 1, delta: "", partial },
	});
}

async function end(
	f: Fixture,
	tool: ToolCall,
	options: { isError?: boolean; isWarning?: boolean; asyncState?: string } = {},
) {
	await f.controller.handleEvent({
		type: "tool_execution_end",
		toolCallId: tool.id,
		toolName: tool.name,
		result: {
			content: [{ type: "text", text: `completed ${tool.id}` }],
			details: options.asyncState ? { async: { state: options.asyncState } } : {},
		},
		isError: options.isError ?? false,
		isWarning: options.isWarning,
	});
}

function gutterFor(f: Fixture, component: unknown): GutterBlock<any> {
	const gutter = f.chat.children.find(child => child instanceof GutterBlock && child.child === component);
	expect(gutter).toBeInstanceOf(GutterBlock);
	return gutter as GutterBlock<any>;
}

describe("EventController completed streamed tool calls", () => {
	beforeEach(async () => {
		_resetSettingsForTest();
		await Settings.init({
			inMemory: true,
			overrides: { "compaction.idleEnabled": false, "completion.notify": "off" },
		});
		await initTheme(false);
	});

	afterEach(() => {
		for (const f of fixtures.splice(0)) {
			f.controller.dispose();
			f.chat.clear();
		}
		vi.restoreAllMocks();
		_resetSettingsForTest();
	});

	for (const outcome of ["success", "warning", "error"] as const) {
		it(`keeps the completed ${outcome} row when later streaming content repeats its call`, async () => {
			const f = fixture();
			fixtures.push(f);
			const first = call("first");
			const second = call("second");
			await start(f, [first]);
			await f.controller.handleEvent({
				type: "tool_execution_start",
				toolCallId: first.id,
				toolName: first.name,
				args: first.arguments,
			});
			const component = f.pending.get(first.id);
			const gutter = gutterFor(f, component);
			const setDone = vi.spyOn(gutter, "setDone");
			await end(f, first, { isError: outcome === "error", isWarning: outcome === "warning" });
			expect(setDone).toHaveBeenCalledWith(outcome);
			const completed = gutter.render(120);
			expect(Bun.stripANSI(completed.join("\n"))).toContain("completed first");
			expect(gutter.state).toBe("done");
			const childCount = f.chat.children.length;
			await update(f, [first, second]);
			expect(f.pending.has(first.id)).toBe(false);
			expect([...f.pending.keys()]).toEqual([second.id]);
			expect(f.chat.children.length).toBe(childCount + 2);
			expect(gutter.render(120)).toEqual(completed);
			await end(f, second);
			await f.controller.handleEvent({ type: "message_end", message: message([first, second]) });
			await f.controller.handleEvent({ type: "agent_end", messages: [message([first, second])] });
			expect(f.pending.size).toBe(0);
			expect(Bun.stripANSI(f.chat.render(120).join("\n"))).not.toContain("[running]");
		});
	}

	it("keeps a completed grouped read removed while its sibling finishes", async () => {
		const f = fixture();
		fixtures.push(f);
		const first = call("first-read", "read");
		const second = call("second-read", "read");
		await start(f, [first, second]);
		const group = f.pending.get(first.id);
		expect(f.pending.get(second.id)).toBe(group);
		const gutter = gutterFor(f, group);
		const setDone = vi.spyOn(gutter, "setDone");
		await end(f, first, { isError: true });
		expect(setDone).not.toHaveBeenCalled();
		const childCount = f.chat.children.length;
		await update(f, [first, second]);
		expect(f.pending.has(first.id)).toBe(false);
		expect(f.pending.get(second.id)).toBe(group);
		expect(f.chat.children.length).toBe(childCount);
		await end(f, second);
		expect(setDone).toHaveBeenCalledWith("error");
		expect(f.pending.size).toBe(0);
		expect(gutter.state).toBe("done");
		const completed = gutter.render(120);
		await update(f, [first, second]);
		expect(f.pending.size).toBe(0);
		expect(gutter.render(120)).toEqual(completed);
	});

	it("starts an active read group after the preceding group has completed", async () => {
		const f = fixture();
		fixtures.push(f);
		const first = call("finished-read", "read");
		const second = call("later-read", "read");
		await start(f, [first]);
		const original = f.pending.get(first.id);
		const originalGutter = gutterFor(f, original);
		await end(f, first);
		expect(originalGutter.state).toBe("done");
		const completed = originalGutter.render(120);
		await update(f, [first, second]);
		const next = f.pending.get(second.id);
		expect(next).not.toBe(original);
		expect(gutterFor(f, next).state).toBe("active");
		expect(originalGutter.render(120)).toEqual(completed);
		await end(f, second);
		expect(gutterFor(f, next).state).toBe("done");
		expect(f.pending.size).toBe(0);
	});

	for (const state of ["completed", "failed"] as const) {
		it(`keeps background ${state} results final after agent settlement`, async () => {
			const f = fixture();
			fixtures.push(f);
			const tool = call("background", "background_probe");
			await start(f, [tool]);
			const component = f.pending.get(tool.id);
			const setDone = vi.spyOn(gutterFor(f, component), "setDone");
			await end(f, tool, { asyncState: "running" });
			await f.controller.handleEvent({ type: "agent_end", messages: [message([tool])] });
			expect(f.pending.get(tool.id)).toBe(component);
			expect(setDone).not.toHaveBeenCalled();
			await f.controller.handleEvent({
				type: "tool_execution_update",
				toolCallId: tool.id,
				toolName: tool.name,
				args: tool.arguments,
				partialResult: { content: [{ type: "text", text: `background ${state}` }], details: { async: { state } } },
			} as AgentSessionEvent);
			const gutter = gutterFor(f, component);
			expect(setDone).toHaveBeenCalledWith(state === "failed" ? "error" : "success");
			expect(gutter.state).toBe("done");
			const completed = gutter.render(120);
			const childCount = f.chat.children.length;
			await start(f, [tool]);
			expect(f.pending.has(tool.id)).toBe(false);
			expect(f.chat.children.length).toBe(childCount + 1);
			expect(gutter.render(120)).toEqual(completed);
		});
	}

	it("retains completion across assistant boundaries and resets it for a new agent run", async () => {
		const f = fixture();
		fixtures.push(f);
		const tool = call("reused-id");
		await start(f, [tool]);
		await end(f, tool);
		await f.controller.handleEvent({ type: "message_end", message: message([tool]) });
		await start(f, [tool]);
		expect(f.pending.has(tool.id)).toBe(false);
		await f.controller.handleEvent({ type: "agent_start" });
		await update(f, [tool]);
		expect(f.pending.has(tool.id)).toBe(true);
	});
});
