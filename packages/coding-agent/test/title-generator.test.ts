import { describe, expect, test, vi } from "bun:test";
import * as ai from "@f5-sales-demo/pi-ai";
import { getBundledModel } from "@f5-sales-demo/pi-ai";
import { logger } from "@f5-sales-demo/pi-utils";
import { SessionManager } from "../src/session/session-manager";
import {
	completedTitleExchanges,
	coordinateSessionTitle,
	generateSessionTitle,
	sanitizeGeneratedSessionTitle,
	subscribeSessionTitle,
	truncateTitleSource,
} from "../src/utils/title-generator";

const model = getBundledModel("anthropic", "claude-sonnet-4-5")!;

function titleDependencies() {
	return {
		registry: {
			getAvailable: () => [model],
			getApiKey: async () => "test-key",
		},
		settings: {
			getModelRole: () => undefined,
			getStorage: () => undefined,
		},
	};
}

describe("session title generation", () => {
	test("uses strict JSON and bounds source text to 960 UTF-8 bytes", async () => {
		const complete = vi.spyOn(ai, "completeSimple").mockResolvedValue({
			stopReason: "end_turn",
			content: [{ type: "text", text: '{"title":"Fix ABC-123 parser","provisional":false}' }],
		} as never);
		const { registry, settings } = titleDependencies();
		const title = await generateSessionTitle(
			`${"🙂".repeat(300)}secret-tail`,
			registry as never,
			settings as never,
			"fixture",
			model,
		);
		expect(title).toBe("Fix ABC-123 parser");
		const request = complete.mock.calls[0]?.[1] as { messages: Array<{ content: string }> };
		const source = request.messages[0]!.content.match(/<user-message>\n([\s\S]*)\n<\/user-message>/)?.[1] ?? "";
		expect(Buffer.byteLength(source)).toBeLessThanOrEqual(960);
		expect(source).not.toContain("secret-tail");
		complete.mockRestore();
	});

	test("rejects malformed or non-exact JSON and sanitizes Unicode output", () => {
		expect(sanitizeGeneratedSessionTitle("not json")).toBeNull();
		expect(sanitizeGeneratedSessionTitle('```json\n{"title":"fenced"}\n```')).toBeNull();
		expect(sanitizeGeneratedSessionTitle('{"title":"ok","extra":true}')).toBeNull();
		expect(sanitizeGeneratedSessionTitle(JSON.stringify({ title: "  修复\u0000票据，ABC-123！  " }))).toBe(
			"修复票据，ABC-123！",
		);
		expect([...sanitizeGeneratedSessionTitle(`{"title":"${"界".repeat(50)}"}`)!]).toHaveLength(36);
	});

	test("accepts a single provider-enforced structured title", async () => {
		const debug = vi.spyOn(logger, "debug").mockImplementation(() => {});
		const complete = vi.spyOn(ai, "completeSimple").mockResolvedValue({
			stopReason: "toolUse",
			content: [
				{
					type: "toolCall",
					id: "title-1",
					name: "submit_title",
					arguments: { title: "Validate session titles", provisional: false },
				},
			],
		} as never);
		const { registry, settings } = titleDependencies();
		expect(await generateSessionTitle("fixture", registry as never, settings as never, "fixture", model)).toBe(
			"Validate session titles",
		);
		const context = complete.mock.calls[0]?.[1];
		const options = complete.mock.calls[0]?.[2];
		expect(context?.tools?.[0]?.name).toBe("submit_title");
		expect(options?.toolChoice).toEqual({ type: "tool", name: "submit_title" });
		expect(debug).toHaveBeenCalledWith(
			"title-generator: response",
			expect.objectContaining({
				title: "Validate session titles",
				titleAccepted: true,
				titleCharacters: 23,
			}),
		);
		complete.mockRestore();
		debug.mockRestore();
	});

	test("truncates without splitting UTF-8 sequences", () => {
		const value = truncateTitleSource(`${"a".repeat(958)}🙂tail`);
		expect(Buffer.byteLength(value)).toBeLessThanOrEqual(960);
		expect(value.endsWith("�")).toBe(false);
	});

	test("falls back to the current model and treats credential or provider failures as non-fatal", async () => {
		const complete = vi.spyOn(ai, "completeSimple").mockResolvedValue({
			stopReason: "end_turn",
			content: [{ type: "text", text: '{"title":"Use current model","provisional":false}' }],
		} as never);
		const settings = titleDependencies().settings;
		const fallbackRegistry = {
			getAvailable: () => [],
			getApiKey: async () => "test-key",
		};
		expect(
			await generateSessionTitle("fallback", fallbackRegistry as never, settings as never, "fixture", model),
		).toBe("Use current model");
		complete.mockRejectedValueOnce(new Error("provider unavailable"));
		expect(
			await generateSessionTitle("provider", fallbackRegistry as never, settings as never, "fixture", model),
		).toBeNull();
		const failingCredentials = { ...fallbackRegistry, getApiKey: async () => Promise.reject(new Error("no key")) };
		expect(
			await generateSessionTitle("credentials", failingCredentials as never, settings as never, "fixture", model),
		).toBeNull();
		complete.mockRestore();
	});

	test("falls back to the current model when the configured title model returns invalid output", async () => {
		const currentModel = { ...model, provider: "openai-codex", id: "gpt-5.6-luna" } as typeof model;
		const complete = vi
			.spyOn(ai, "completeSimple")
			.mockResolvedValueOnce({
				stopReason: "stop",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				content: [{ type: "text", text: "```json fenced```" }],
			} as never)
			.mockResolvedValueOnce({
				stopReason: "toolUse",
				content: [
					{
						type: "toolCall",
						id: "title-2",
						name: "submit_title",
						arguments: { title: "Use current model", provisional: false },
					},
				],
			} as never);
		const registry = {
			getAvailable: () => [model],
			getApiKey: async () => "test-key",
		};
		const settings = {
			getModelRole: (role: string) => (role === "smol" ? "anthropic/claude-sonnet-4-5" : undefined),
			getStorage: () => undefined,
		};
		expect(await generateSessionTitle("fixture", registry as never, settings as never, "fixture", currentModel)).toBe(
			"Use current model",
		);
		expect(complete.mock.calls.map(call => `${call[0].provider}/${call[0].id}`)).toEqual([
			"anthropic/claude-sonnet-4-5",
			"openai-codex/gpt-5.6-luna",
		]);
		complete.mockRestore();
	});
});

function exchangeEntries(user = "hello", assistant = "Hello!", id = "opening") {
	return [
		{ type: "message", id, message: { role: "user", content: user } },
		{
			type: "message",
			id: `${id}-answer`,
			message: {
				role: "assistant",
				content: [{ type: "text", text: assistant }],
				stopReason: "stop",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			},
		},
	];
}

function titleTarget() {
	const manager = SessionManager.inMemory("/tmp/title-fixture");
	const target = {
		get sessionId() {
			return manager.getSessionId();
		},
		model,
		modelRegistry: titleDependencies().registry,
		settings: titleDependencies().settings,
		sessionManager: manager,
		setSessionName: manager.setSessionName.bind(manager),
	};
	const append = (user = "hello", assistant = "Hello!") => {
		for (const entry of exchangeEntries(user, assistant)) manager.appendMessage(entry.message as never);
	};
	return { target, manager, append };
}

test("waits for both sides of a completed exchange and shares one flight", async () => {
	const { target, manager } = titleTarget();
	let calls = 0;
	let finish!: (result: { title: string; provisional: boolean }) => void;
	const generate = async (source: string) => {
		calls++;
		expect(source).toContain("hello");
		expect(source).toContain("Hello!");
		return new Promise<{ title: string; provisional: boolean }>(resolve => {
			finish = resolve;
		});
	};
	expect(await coordinateSessionTitle(target as never, generate)).toBeNull();
	manager.appendMessage(exchangeEntries()[0]!.message as never);
	expect(await coordinateSessionTitle(target as never, generate)).toBeNull();
	manager.appendMessage(exchangeEntries()[1]!.message as never);
	const updates: string[] = [];
	const unsubscribe = subscribeSessionTitle(manager, title => updates.push(title));
	const first = coordinateSessionTitle(target as never, generate);
	expect(coordinateSessionTitle(target as never, generate)).toBe(first);
	finish({ title: "Opening chat", provisional: true });
	expect(await first).toBe("Opening chat");
	expect(calls).toBe(1);
	expect(await coordinateSessionTitle(target as never, generate)).toBeNull();
	expect(updates).toEqual(["Opening chat"]);
	unsubscribe();
});

test("model judgment refines a provisional name once and keeps established names", async () => {
	const { target, manager, append } = titleTarget();
	append();
	await coordinateSessionTitle(target as never, async () => ({ title: "Opening chat", provisional: true }));
	append("help me", "What would you like to do?");
	await coordinateSessionTitle(target as never, async () => ({ title: "Still opening", provisional: true }));
	expect(manager.getSessionName()).toBe("Opening chat");
	append("Fix ABC-123 parser", "I will inspect the parser and repair it.");
	await coordinateSessionTitle(target as never, async source => {
		expect(source).toContain("Opening chat");
		expect(source).toContain("repair it");
		return { title: "Fix ABC-123 parser", provisional: false };
	});
	expect(manager.getAutomaticTitleState()?.status).toBe("refined");
	append("Change task", "OK");
	let calls = 0;
	await coordinateSessionTitle(target as never, async () => {
		calls++;
		return { title: "Other", provisional: false };
	});
	expect(calls).toBe(0);
	expect(manager.getSessionName()).toBe("Fix ABC-123 parser");
});

test("rejects late results after manual renames and session switches including switching back", async () => {
	for (const transition of ["rename", "switch", "switch-back"]) {
		const { target, manager, append } = titleTarget();
		append();
		let finish!: (result: { title: string; provisional: boolean }) => void;
		const pending = coordinateSessionTitle(
			target as never,
			async () =>
				new Promise(resolve => {
					finish = resolve;
				}),
		);
		if (transition === "rename") await manager.setSessionName("Manual", "user");
		else {
			const snapshot = manager.captureState();
			await manager.newSession();
			if (transition === "switch-back") manager.restoreState(snapshot);
		}
		finish({ title: "Stale", provisional: false });
		expect(await pending).toBeNull();
		expect(manager.getSessionName()).not.toBe("Stale");
	}
});

test("legacy saved names stay unchanged and naming failures remain nonfatal", async () => {
	const { target, manager, append } = titleTarget();
	append();
	expect(
		await coordinateSessionTitle(target as never, async () => {
			throw new Error("offline");
		}),
	).toBeNull();
	await manager.setSessionName("Existing", "auto");
	let calls = 0;
	await coordinateSessionTitle(target as never, async () => {
		calls++;
		return { title: "New", provisional: false };
	});
	expect(calls).toBe(0);
	expect(manager.getSessionName()).toBe("Existing");
});

test("uses finalized voice exchanges while ignoring deltas, interrupted turns, tails and delegated wrappers", () => {
	const entries = [
		...exchangeEntries("failed", "failure", "failed").map(entry =>
			entry.message.role === "assistant"
				? { ...entry, message: { ...entry.message, stopReason: "aborted" } }
				: entry,
		),
		{
			type: "custom",
			id: "voice-user",
			customType: "remote-realtime",
			data: { kind: "transcript", role: "user", text: "bonjour" },
		},
		{
			type: "custom",
			id: "tail",
			customType: "remote-realtime",
			data: { kind: "transcriptTail", transcript: [{ role: "assistant", text: "partial" }] },
		},
		...exchangeEntries("<realtime_delegation>wrapper</realtime_delegation>", "Backend complete", "backend"),
		{
			type: "custom",
			id: "voice-answer",
			customType: "remote-realtime",
			data: { kind: "transcript", role: "assistant", text: "Bonjour!" },
		},
	];
	const result = completedTitleExchanges(entries as never);
	expect(result).toEqual([{ id: "voice-user", user: "bonjour", assistant: "Bonjour!" }]);
});

test("does not name failed or interrupted first exchanges", async () => {
	for (const stopReason of ["error", "aborted"]) {
		const { target, manager } = titleTarget();
		const entries = exchangeEntries();
		manager.appendMessage(entries[0]!.message as never);
		manager.appendMessage({ ...entries[1]!.message, stopReason } as never);
		let calls = 0;
		await coordinateSessionTitle(target as never, async () => {
			calls++;
			return { title: "Invalid", provisional: false };
		});
		expect(calls).toBe(0);
		expect(manager.getSessionName()).toBeUndefined();
	}
});

test("a second completed exchange during inference receives its own refinement", async () => {
	const { target, manager, append } = titleTarget();
	append();
	let resolve!: (value: { title: string; provisional: boolean }) => void;
	let calls = 0;
	const generate = async () => {
		calls++;
		if (calls === 1)
			return new Promise<{ title: string; provisional: boolean }>(done => {
				resolve = done;
			});
		return { title: "Fix parser", provisional: false };
	};
	const pending = coordinateSessionTitle(target as never, generate);
	append("Fix parser", "I will fix it.");
	resolve({ title: "Opening", provisional: true });
	await pending;
	await Bun.sleep(0);
	expect(calls).toBe(2);
	expect(manager.getSessionName()).toBe("Fix parser");
});

test("bounds serialized long exchanges without discarding either speaker", async () => {
	const { target, append } = titleTarget();
	append(`user-start ${'"'.repeat(500)}`, `assistant-start ${'"'.repeat(500)}`);
	await coordinateSessionTitle(target as never, async source => {
		expect(Buffer.byteLength(source)).toBeLessThanOrEqual(960);
		expect(source).toContain("user-start");
		expect(source).toContain("assistant-start");
		return { title: "Long conversation", provisional: false };
	});
});
