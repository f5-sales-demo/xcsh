import { describe, expect, test } from "bun:test";
import {
	buildRecapPrompt,
	parseRecapResponse,
	RECAP_ENTRY_TYPE,
	type RecapRecord,
	RecapService,
	readRecaps,
} from "../src/session/recap";
import { SessionManager } from "../src/session/session-manager";

const message = (id: string, role: "user" | "assistant" | "toolResult", text: string) => ({
	type: "message" as const,
	id,
	parentId: null,
	timestamp: new Date().toISOString(),
	message: { role, content: [{ type: "text" as const, text }], timestamp: Date.now(), stopReason: "stop" },
});

describe("recap input", () => {
	test("keeps eight recent exchanges and the newest unanswered correction", () => {
		const entries = Array.from({ length: 12 }, (_, index) => [
			message(`u${index}`, "user", `request ${index}`),
			message(`a${index}`, "assistant", `answer ${index}`),
			message(`t${index}`, "toolResult", `secret tool ${index}`),
		]).flat();
		entries.push(message("correction", "user", "Correction: use the later target"));
		const prompt = buildRecapPrompt(entries);
		expect(prompt).toContain("request 4");
		expect(prompt).not.toContain("request 3");
		expect(prompt).toContain("Correction: use the later target");
		expect(prompt).not.toContain("secret tool");
	});

	test("bounds UTF-8 input even with a large newest message", () => {
		const prompt = buildRecapPrompt([message("u", "user", "🪐".repeat(10000))]);
		expect(Buffer.byteLength(prompt)).toBeLessThanOrEqual(32 * 1024);
	});

	test("large history retains the newest answer and the tail of an unanswered correction", () => {
		const prompt = buildRecapPrompt([
			message("u1", "user", `Initial goal ${"a".repeat(40_000)}`),
			message("a1", "assistant", `Validation caveat ${"b".repeat(40_000)} BLOCKER`),
			message("u2", "user", `Correction ${"c".repeat(40_000)} LATEST TARGET`),
		]);
		expect(Buffer.byteLength(prompt)).toBeLessThanOrEqual(32 * 1024);
		expect(prompt).toContain("BLOCKER");
		expect(prompt).toContain("LATEST TARGET");
		expect(prompt.match(/LATEST TARGET/g)).toHaveLength(1);
	});

	test("rejects malformed or overlong JSON output", () => {
		expect(() => parseRecapResponse("```json\n{}\n```")).toThrow();
		expect(() => parseRecapResponse(JSON.stringify({ summary: "a".repeat(701) }))).toThrow();
		expect(() => parseRecapResponse(JSON.stringify({ summary: "ok", next_action: "n".repeat(201) }))).toThrow();
		expect(parseRecapResponse('{"summary":"Done","next_action":"Verify"}')).toEqual({
			summary: "Done",
			nextAction: "Verify",
		});
	});
});

describe("recap scheduling", () => {
	test("manual request explains an empty conversation", async () => {
		const service = new RecapService({
			getState: () => ({
				sessionId: "s",
				entries: [],
				completedTurnCount: 0,
				focused: true,
				idle: true,
				auto: true,
			}),
			generateText: async () => {
				throw new Error("should not call model");
			},
			save: () => {},
		});
		await expect(service.generate("manual")).rejects.toThrow("no conversation history");
	});

	test("restored recap entries stay outside model context", () => {
		const session = SessionManager.inMemory();
		session.appendMessage({ role: "user", content: "Goal", timestamp: 1 });
		const recap: RecapRecord = {
			id: "r1",
			sessionId: session.getSessionId(),
			trigger: "manual",
			summary: "Goal is open",
			completedTurnCount: 0,
			createdAt: "2026-09-25T00:00:00.000Z",
		};
		session.appendCustomEntry(RECAP_ENTRY_TYPE, recap);
		expect(readRecaps(session.getBranch())).toEqual([recap]);
		expect(session.buildSessionContext().messages).toHaveLength(1);
	});

	test("generates only after three turns and thirty minutes unfocused, then waits for two new turns", async () => {
		let now = 0;
		let callback: (() => void) | undefined;
		let turnCount = 2;
		let focused = true;
		const saved: RecapRecord[] = [];
		const service = new RecapService({
			getState: () => ({
				sessionId: "s",
				entries: [message("u", "user", "Goal")],
				completedTurnCount: turnCount,
				focused,
				idle: true,
				auto: true,
			}),
			generateText: async () => '{"summary":"Done"}',
			save: record => saved.push(record),
			now: () => now,
			setTimer: (fn, _ms) => {
				callback = fn;
				return 1;
			},
			clearTimer: () => {
				callback = undefined;
			},
		});
		service.refresh();
		focused = false;
		service.refresh();
		turnCount = 3;
		service.refresh();
		now = 30 * 60 * 1000;
		const fire = callback;
		callback = undefined;
		fire?.();
		await Bun.sleep(0);
		expect(saved).toHaveLength(1);
		turnCount = 4;
		service.refresh();
		expect(callback).toBeUndefined();
	});

	test("waits thirty minutes after a newly completed turn while unfocused", () => {
		let now = 0;
		let turnCount = 2;
		let due = -1;
		const service = new RecapService({
			getState: () => ({
				sessionId: "s",
				entries: [message("u", "user", "Goal")],
				completedTurnCount: turnCount,
				focused: false,
				idle: true,
				auto: true,
			}),
			generateText: async () => '{"summary":"Done"}',
			save: () => {},
			now: () => now,
			setTimer: (_callback, ms) => {
				due = ms;
				return 1;
			},
			clearTimer: () => {},
		});
		service.refresh();
		now = 29 * 60 * 1000;
		turnCount = 3;
		service.refresh();
		expect(due).toBe(30 * 60 * 1000);
		now += 29 * 60 * 1000;
		service.refresh();
		expect(due).toBe(60 * 1000);
		service.dispose();
	});

	test("opt-out and stale turn revisions discard pending results", async () => {
		let resolve!: (value: string) => void;
		let auto = true;
		let revision = "a";
		const saved: RecapRecord[] = [];
		const service = new RecapService({
			getState: () => ({
				sessionId: "s",
				entries: [message("u", "user", "Goal")],
				completedTurnCount: 3,
				revision,
				focused: false,
				idle: true,
				auto,
			}),
			generateText: () =>
				new Promise<string>(r => {
					resolve = r;
				}),
			save: record => saved.push(record),
			now: () => 30 * 60 * 1000,
		});
		service.refresh();
		const pending = service.generate("manual");
		await Promise.resolve();
		revision = "b";
		resolve('{"summary":"Stale"}');
		await pending;
		expect(saved).toHaveLength(0);
		auto = false;
		service.refresh();
		expect(await service.generate("automatic")).toBeNull();
	});

	test("session switch and opt-out discard an automatic result", async () => {
		let sessionId = "first";
		let auto = true;
		let now = 0;
		let resolve!: (value: string) => void;
		const saved: RecapRecord[] = [];
		const service = new RecapService({
			getState: () => ({
				sessionId,
				entries: [message("u", "user", "Goal")],
				completedTurnCount: 3,
				focused: false,
				idle: true,
				auto,
			}),
			generateText: () =>
				new Promise<string>(r => {
					resolve = r;
				}),
			save: record => saved.push(record),
			now: () => now,
		});
		service.refresh();
		// The request is already running when the user disables automatic recaps.
		now = 30 * 60 * 1000;
		const pending = service.generate("automatic");
		await Promise.resolve();
		auto = false;
		sessionId = "second";
		service.refresh();
		resolve('{"summary":"Old session"}');
		expect(await pending).toBeNull();
		expect(saved).toEqual([]);
		service.dispose();
	});

	test("automatic failure retries once after thirty seconds for the same revision", async () => {
		let now = 0;
		let callback: (() => void) | undefined;
		const delays: number[] = [];
		let calls = 0;
		const service = new RecapService({
			getState: () => ({
				sessionId: "s",
				entries: [message("u", "user", "Goal")],
				completedTurnCount: 3,
				focused: false,
				idle: true,
				auto: true,
			}),
			generateText: async () => {
				calls++;
				throw new Error("provider failed");
			},
			save: () => {
				throw new Error("unexpected save");
			},
			now: () => now,
			setTimer: (fn, delay) => {
				callback = fn;
				delays.push(delay);
				return 1;
			},
			clearTimer: () => {
				callback = undefined;
			},
		});
		service.refresh();
		now = 30 * 60 * 1000;
		const first = callback!;
		callback = undefined;
		first();
		await Bun.sleep(0);
		expect(calls).toBe(1);
		expect(delays.at(-1)).toBe(30_000);
		now += 30_000;
		const second = callback!;
		callback = undefined;
		second();
		await Bun.sleep(0);
		expect(calls).toBe(2);
		expect(callback).toBeUndefined();
	});
});
