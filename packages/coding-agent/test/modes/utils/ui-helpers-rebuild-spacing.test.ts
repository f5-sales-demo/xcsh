import { afterAll, beforeAll, describe, expect, test, vi } from "bun:test";
import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import { Container, Spacer } from "@f5-sales-demo/pi-tui";
import { _resetSettingsForTest, Settings } from "@f5-sales-demo/xcsh/config/settings";
import { initTheme } from "@f5-sales-demo/xcsh/modes/theme/theme";
import type { InteractiveModeContext } from "@f5-sales-demo/xcsh/modes/types";
import { UiHelpers } from "@f5-sales-demo/xcsh/modes/utils/ui-helpers";
import type { SessionContext } from "@f5-sales-demo/xcsh/session/session-manager";

function baseCtx(): InteractiveModeContext {
	return {
		chatContainer: new Container(),
		pendingTools: new Map(),
		ui: { requestRender: vi.fn() },
		sessionManager: { getCwd: () => "/tmp" },
		session: { getToolByName: () => undefined },
		statusLine: { invalidate: vi.fn() },
		updateEditorBorderColor: vi.fn(),
		addMessageToChat: vi.fn(),
		toolOutputExpanded: false,
		getUserMessageText: () => "",
		optimisticUserMessageSignature: undefined,
	} as unknown as InteractiveModeContext;
}

function emptySessionContext(messages: AgentMessage[]): SessionContext {
	return {
		messages,
		models: {},
		injectedTtsrRules: [],
		selectedMCPToolNames: [],
		hasPersistedMCPToolSelection: false,
		mode: "none",
	} as SessionContext;
}

describe("UiHelpers.renderSessionContext spacing", () => {
	beforeAll(async () => {
		initTheme();
		await Settings.init({ inMemory: true, cwd: "/tmp" });
	});

	afterAll(() => {
		_resetSettingsForTest();
	});

	test("inserts Spacer(1) before a non-Read tool gutter", () => {
		const ctx = baseCtx();
		const helpers = new UiHelpers(ctx);

		const messages: AgentMessage[] = [
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "call-bash-1",
						name: "bash",
						arguments: { command: "echo hi" },
					},
				],
				usage: undefined,
				stopReason: null,
			} as unknown as AgentMessage,
		];

		helpers.renderSessionContext(emptySessionContext(messages));

		const children = ctx.chatContainer.children;
		expect(children.length).toBe(2);
		expect(children[0]).toBeInstanceOf(Spacer);
		expect(children[1]).not.toBeInstanceOf(Spacer);
	});

	test("inserts Spacer(1) before a fresh Read-group gutter and NOT between consecutive Reads", () => {
		const ctx = baseCtx();
		const helpers = new UiHelpers(ctx);

		const messages: AgentMessage[] = [
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "read-1",
						name: "read",
						arguments: { path: "/tmp/a.txt" },
					},
					{
						type: "toolCall",
						id: "read-2",
						name: "read",
						arguments: { path: "/tmp/b.txt" },
					},
				],
				usage: undefined,
				stopReason: undefined,
			} as unknown as AgentMessage,
			{
				role: "toolResult",
				toolName: "read",
				toolCallId: "read-1",
				content: [{ type: "text", text: "file contents" }],
				isError: false,
			} as unknown as AgentMessage,
			{
				role: "toolResult",
				toolName: "read",
				toolCallId: "read-2",
				content: [{ type: "text", text: "file contents 2" }],
				isError: false,
			} as unknown as AgentMessage,
		];

		helpers.renderSessionContext(emptySessionContext(messages));

		const children = ctx.chatContainer.children;
		const spacers = children.filter(c => c instanceof Spacer);
		expect(spacers.length).toBe(1);
	});

	test("inserts Spacer(1) before a Read-group gutter on an error-stopped assistant message", () => {
		const ctx = baseCtx();
		const helpers = new UiHelpers(ctx);

		const messages: AgentMessage[] = [
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "read-err",
						name: "read",
						arguments: { path: "/tmp/a.txt" },
					},
				],
				usage: undefined,
				stopReason: "error",
				errorMessage: "boom",
			} as unknown as AgentMessage,
		];

		helpers.renderSessionContext(emptySessionContext(messages));

		const children = ctx.chatContainer.children;
		const spacers = children.filter(c => c instanceof Spacer);
		expect(spacers.length).toBeGreaterThanOrEqual(1);
	});
});
