import { describe, expect, test, vi } from "bun:test";
import * as ai from "@f5-sales-demo/pi-ai";
import { getBundledModel } from "@f5-sales-demo/pi-ai";
import {
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
			content: [{ type: "text", text: '{"title":"Fix ABC-123 parser"}' }],
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
		const complete = vi.spyOn(ai, "completeSimple").mockResolvedValue({
			stopReason: "toolUse",
			content: [
				{
					type: "toolCall",
					id: "title-1",
					name: "submit_title",
					arguments: { title: "Validate session titles" },
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
		complete.mockRestore();
	});

	test("truncates without splitting UTF-8 sequences", () => {
		const value = truncateTitleSource(`${"a".repeat(958)}🙂tail`);
		expect(Buffer.byteLength(value)).toBeLessThanOrEqual(960);
		expect(value.endsWith("�")).toBe(false);
	});

	test("falls back to the current model and treats credential or provider failures as non-fatal", async () => {
		const complete = vi.spyOn(ai, "completeSimple").mockResolvedValue({
			stopReason: "end_turn",
			content: [{ type: "text", text: '{"title":"Use current model"}' }],
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
			.mockResolvedValueOnce({ stopReason: "stop", content: [{ type: "text", text: "```json fenced```" }] } as never)
			.mockResolvedValueOnce({
				stopReason: "toolUse",
				content: [
					{ type: "toolCall", id: "title-2", name: "submit_title", arguments: { title: "Use current model" } },
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

test("title coordination is per-session single-flight and manual names win races", async () => {
	let resolve!: (value: string | null) => void;
	let calls = 0;
	let name: string | undefined;
	let source: "auto" | "user" | undefined;
	const manager = {
		getSessionName: () => name,
		get titleSource() {
			return source;
		},
		setSessionName: async (value: string, next: "auto" | "user") => {
			if (source === "user" && next === "auto") return false;
			name = value;
			source = next;
			return true;
		},
	};
	const target = {
		sessionId: "fixture",
		model,
		modelRegistry: titleDependencies().registry,
		settings: titleDependencies().settings,
		sessionManager: manager,
		setSessionName: manager.setSessionName,
	};
	const generate = async () => {
		calls++;
		return await new Promise<string | null>(done => {
			resolve = done;
		});
	};
	const updates: string[] = [];
	const first = coordinateSessionTitle(target as never, "first", title => updates.push(title), generate);
	const second = coordinateSessionTitle(target as never, "second", title => updates.push(title), generate);
	expect(first).toBe(second);
	expect(calls).toBe(1);
	await manager.setSessionName("Manual winner", "user");
	resolve("Generated loser");
	expect(await first).toBeNull();
	expect(name).toBe("Manual winner");
	expect(updates).toEqual([]);
});

test("shared title subscribers observe one accepted automatic title", async () => {
	let name: string | undefined;
	const manager = { getSessionName: () => name };
	const target = {
		sessionId: "shared",
		model,
		modelRegistry: titleDependencies().registry,
		settings: titleDependencies().settings,
		sessionManager: manager,
		setSessionName: async (value: string) => {
			name = value;
			return true;
		},
	};
	const updates: string[] = [];
	const unsubscribe = subscribeSessionTitle(manager, title => updates.push(title));
	await coordinateSessionTitle(target as never, "fixture", undefined, async () => "Generated once");
	expect(updates).toEqual(["Generated once"]);
	unsubscribe();
});

test("manual names win before and after generation, and a reused manager gets a new per-thread flight", async () => {
	let name: string | undefined = "Named first";
	let source: "auto" | "user" | undefined = "user";
	let calls = 0;
	const manager = { getSessionName: () => name };
	const target = {
		sessionId: "first-thread",
		model,
		modelRegistry: titleDependencies().registry,
		settings: titleDependencies().settings,
		sessionManager: manager,
		setSessionName: async (value: string, next: "auto" | "user") => {
			if (source === "user" && next === "auto") return false;
			name = value;
			source = next;
			return true;
		},
	};
	const generate = async () => `Generated ${++calls}`;
	expect(await coordinateSessionTitle(target as never, "ignored", undefined, generate)).toBeNull();
	expect(calls).toBe(0);

	name = undefined;
	source = undefined;
	target.sessionId = "second-thread";
	expect(await coordinateSessionTitle(target as never, "second", undefined, generate)).toBe("Generated 1");
	await target.setSessionName("Manual after", "user");
	expect(manager.getSessionName()).toBe("Manual after");

	name = undefined;
	source = undefined;
	target.sessionId = "third-thread";
	expect(await coordinateSessionTitle(target as never, "third", undefined, generate)).toBe("Generated 2");
	expect(calls).toBe(2);
});
