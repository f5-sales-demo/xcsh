import { expect, test } from "bun:test";
import { handoffOptions, VoiceHandoff } from "../../src/remote-control/voice-handoff";
import reference from "./fixtures/codex-0.153.4-phone-delegation.json";

function fixture(mode = "bemTags", prefixes?: Record<string, string[]>) {
	const sent: { channel?: string; text: string }[] = [];
	const timers = new Set<() => void>();
	const handoff = new VoiceHandoff(
		handoffOptions({ codexResponseHandoffMode: mode, codexResponseHandoffChannelPrefixes: prefixes }),
		(channel, text) => sent.push({ channel, text }),
		callback => {
			timers.add(callback);
			return () => timers.delete(callback);
		},
	);
	return {
		handoff,
		sent,
		flush: () => {
			const pending = [...timers];
			timers.clear();
			for (const callback of pending) callback();
		},
	};
}

test("recorded commentary and speakable chunks stream before completion with no final replay", () => {
	const f = fixture();
	const chunks = reference.scenario.sideband.filter(row => row.message.type === "delegation.context.append");
	const text: Record<string, string> = {};
	for (const row of chunks) {
		const channel = (row.message as { channel: string }).channel;
		text[channel] = `${text[channel] ?? (channel === "commentary" ? "[COMMENTARY]" : "[FINAL]")} fixture`;
		f.handoff.update({ id: channel, text: text[channel], done: false });
		f.flush();
	}
	expect(f.sent.map(row => row.channel)).toEqual(chunks.map(row => (row.message as { channel: string }).channel));
	for (const [id, value] of Object.entries(text)) f.handoff.update({ id, text: value, done: true });
	f.handoff.finish(text.speakable);
	expect(f.sent).toHaveLength(10);
});

test("partial custom channel prefixes wait for recognition and preserve their envelope", () => {
	const f = fixture("bemTags", { final: ["[SAY]"], commentary: ["[PROGRESS]"] });
	f.handoff.update({ id: "i", text: "[PRO", done: false });
	f.flush();
	expect(f.sent).toEqual([]);
	f.handoff.update({ id: "i", text: "[PROGRESS]Working", done: false });
	f.flush();
	expect(f.sent).toEqual([{ channel: "commentary", text: "[PROGRESS]Working" }]);
	f.handoff.update({ id: "i", text: "[PROGRESS]Working now", done: true });
	expect(f.sent[1]).toEqual({ channel: "commentary", text: " now" });
});

test.each(["thinking", "commentary"])("pinned %s mode respects its channel policy", mode => {
	const f = fixture(mode);
	f.handoff.update({ id: "i", text: "progress", phase: "commentary", done: false });
	f.flush();
	expect(f.sent).toEqual([{ channel: mode === "thinking" ? undefined : "commentary", text: "progress" }]);
	f.handoff.close();
});

test("unrecognized BEM text is retained until completion and falls back to speakable", () => {
	const f = fixture();
	f.handoff.update({ id: "i", text: "Plain final", done: false });
	f.flush();
	expect(f.sent).toEqual([]);
	f.handoff.update({ id: "i", text: "Plain final", done: true });
	expect(f.sent).toEqual([{ channel: "speakable", text: "Plain final" }]);
	f.handoff.update({ id: "i", text: "Plain final", done: true });
	f.handoff.finish("Plain final");
	expect(f.sent).toHaveLength(1);
});

test("closing drops scheduled speech and ignores later backing output", () => {
	const f = fixture();
	f.handoff.update({ id: "i", text: "[FINAL]Before", done: false });
	f.handoff.close();
	f.flush();
	f.handoff.update({ id: "i", text: "[FINAL]Before after", done: true });
	f.handoff.finish("late result");
	expect(f.sent).toEqual([]);
});

test("completed-only providers still return a result", () => {
	const f = fixture();
	f.handoff.finish("The fixture is updated.");
	expect(f.sent).toEqual([{ channel: "speakable", text: "The fixture is updated." }]);
});

test("long Unicode output preserves a bounded head and tail without splitting characters", () => {
	const f = fixture();
	const output = `[FINAL]${"🌳".repeat(2000)}TAIL`;
	f.handoff.update({ id: "i", text: output, done: false });
	f.flush();
	f.handoff.update({ id: "i", text: output, done: true });
	const text = f.sent.map(row => row.text).join("");
	expect(Buffer.byteLength(text)).toBeLessThanOrEqual(4000);
	expect(text.startsWith("[FINAL]🌳")).toBe(true);
	expect(text.endsWith("TAIL")).toBe(true);
	expect(text).toContain("…output truncated…");
	expect(text).not.toContain("�");
});

test("invalid routing configuration fails before creating a call", () => {
	expect(handoffOptions({}).mode).toBe("thinking");
	for (const params of [
		{ codexResponseHandoffMode: "other" },
		{ codexResponseHandoffChannelPrefixes: { final: "bad" } },
		{ codexResponseHandoffChannelPrefixes: { final: [42] } },
	])
		expect(() => handoffOptions(params)).toThrow();
});

test("flush pacing uses time since the last flush rather than delaying another full interval", () => {
	let now = 0;
	const delays: number[] = [];
	const callbacks: (() => void)[] = [];
	const handoff = new VoiceHandoff(
		handoffOptions({ codexResponseHandoffMode: "bemTags" }),
		() => {},
		(callback, delay) => {
			delays.push(delay);
			callbacks.push(callback);
			return () => {};
		},
		() => now,
	);
	handoff.update({ id: "i", text: "[FINAL]One", done: false });
	now = 200;
	callbacks[0]();
	now = 350;
	handoff.update({ id: "i", text: "[FINAL]One two", done: false });
	expect(delays).toEqual([200, 50]);
	handoff.close();
});

test("cumulative input retained across items has a total bound", () => {
	const f = fixture();
	const text = "x".repeat(800_000);
	f.handoff.update({ id: "one", text, done: false });
	f.handoff.update({ id: "two", text, done: false });
	expect(() => f.handoff.update({ id: "three", text, done: false })).toThrow("limit");
	f.handoff.close();
});
