import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { AssistantMessage } from "@f5-sales-demo/pi-ai";
import { TERMINAL } from "@f5-sales-demo/pi-tui";
import { _resetSettingsForTest, Settings } from "../../../src/config/settings";
import { EventController } from "../../../src/modes/controllers/event-controller";
import type { InteractiveModeContext } from "../../../src/modes/types";
import type { AgentSessionEvent } from "../../../src/session/agent-session";

function assistantMessage(): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "completed in the background" }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

const agentEnd = (): Extract<AgentSessionEvent, { type: "agent_end" }> => ({
	type: "agent_end",
	messages: [assistantMessage()],
});

async function waitUntil(predicate: () => boolean): Promise<void> {
	const deadline = performance.now() + 500;
	while (performance.now() < deadline) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Timed out waiting for background lifecycle assertion");
}

describe("EventController background lifecycle", () => {
	const originalHerdr = process.env.HERDR_ENV;

	beforeEach(async () => {
		_resetSettingsForTest();
		await Settings.init({ inMemory: true, overrides: { "completion.notify": "on" } });
		delete process.env.HERDR_ENV;
	});

	afterEach(() => {
		if (originalHerdr === undefined) delete process.env.HERDR_ENV;
		else process.env.HERDR_ENV = originalHerdr;
		vi.restoreAllMocks();
		_resetSettingsForTest();
	});

	it("waits for both agent and outer prompt settlement and rejects duplicate trackers", async () => {
		let streaming = true;
		const idle = Promise.withResolvers<void>();
		const waitForIdle = vi.fn(() => idle.promise);
		const shutdown = vi.fn(async () => {});
		const context = {
			isBackgrounded: true,
			session: {
				waitForIdle,
				get isStreaming() {
					return streaming;
				},
				queuedMessageCount: 0,
			},
			sessionManager: { getSessionName: () => "Synthetic session" },
			shutdown,
		} as unknown as InteractiveModeContext;
		const controller = new EventController(context);

		controller.beginBackgroundCompletionTracking();
		controller.beginBackgroundCompletionTracking();
		await waitUntil(() => waitForIdle.mock.calls.length === 1);
		expect(shutdown).not.toHaveBeenCalled();

		idle.resolve();
		await Bun.sleep(5);
		expect(shutdown).not.toHaveBeenCalled();
		streaming = false;
		await waitUntil(() => shutdown.mock.calls.length === 1);
		expect(waitForIdle).toHaveBeenCalledTimes(1);
	});

	it("defers queued work and retries on the later completion event", async () => {
		let queued = 1;
		const waitForIdle = vi.fn(async () => {});
		const shutdown = vi.fn(async () => {});
		const context = {
			isBackgrounded: true,
			session: {
				waitForIdle,
				isStreaming: false,
				get queuedMessageCount() {
					return queued;
				},
			},
			sessionManager: { getSessionName: () => undefined },
			shutdown,
		} as unknown as InteractiveModeContext;
		const controller = new EventController(context);

		await controller.handleBackgroundEvent(agentEnd());
		await waitUntil(() => waitForIdle.mock.calls.length === 1);
		await Bun.sleep(5);
		expect(shutdown).not.toHaveBeenCalled();

		queued = 0;
		await controller.handleBackgroundEvent(agentEnd());
		await waitUntil(() => shutdown.mock.calls.length === 1);
		expect(waitForIdle).toHaveBeenCalledTimes(2);
	});

	it("uses only Herdr's out-of-band notification path after shell detachment", () => {
		const sendNotification = vi.spyOn(TERMINAL, "sendNotification").mockImplementation(() => {});
		const context = {
			isBackgrounded: true,
			sessionManager: { getSessionName: () => "Synthetic session" },
		} as unknown as InteractiveModeContext;
		const controller = new EventController(context);

		controller.sendCompletionNotification(agentEnd());
		expect(sendNotification).not.toHaveBeenCalled();

		process.env.HERDR_ENV = "1";
		controller.sendCompletionNotification(agentEnd());
		expect(sendNotification).toHaveBeenCalledWith({
			title: "Synthetic session",
			body: "Complete",
			type: "completion",
		});
	});
});
