import { expect, test } from "bun:test";
import { type TimelineInput, VoiceTimeline } from "../../src/remote-control/voice-timeline";
import presentationReference from "./fixtures/codex-0.153.4-timeline-presentation.json";

// Source contracts: pinned core/src/realtime_history.rs, presentation.rs and realtime_history_tests.rs.
function fixture() {
	let id = 0;
	const state = new VoiceTimeline(() => `fixture-${++id}`);
	state.observe({ type: "turnStarted", turnId: "turn-1" });
	state.observe({ type: "start", sessionId: "voice-1" });
	return state;
}
const text = (value: string, done = false): TimelineInput => ({
	type: "transcript",
	role: "assistant",
	text: value,
	done,
});
const message = (value: string, completed = true, id = "message-1"): TimelineInput => ({
	type: "item",
	turnId: "turn-1",
	completed,
	item: { type: "agentMessage", id, text: value },
});
const markdown = "::codex-realtime-inline{}\nFixture result";

test("explicit empty identities remain present in turn-to-call associations", () => {
	const state = new VoiceTimeline();
	state.observe({ type: "turnStarted", turnId: "" });
	state.observe({ type: "start", sessionId: "" });
	const effects = state.observe({ ...message(markdown), turnId: "" } as TimelineInput);
	expect(effects.items[0]).toMatchObject({ realtimeSessionId: "", turnId: "" });
});

test("generated canonical session and item identities use the pinned UUID version", () => {
	const item = new VoiceTimeline().observe({ type: "start" }).items[0];
	const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
	expect(item.id).toMatch(uuidV7);
	expect(item.realtimeSessionId).toMatch(uuidV7);
});

test.each(presentationReference.cases)("original Rust presentation fixture: $text", ({ text, presentations }) => {
	expect(
		fixture()
			.observe(message(text))
			.items.map(item => item.presentation),
	).toEqual(presentations);
});

test("promotion splits speech, preserves empty continuations and does not duplicate a repeated final", () => {
	const state = fixture();
	const first = state.observe(text("Before"));
	expect(first.stream?.startedItem?.type).toBe("transcriptSegment");
	const promotion = state.observe(message(markdown));
	expect(promotion.items.map(item => item.type)).toEqual(["transcriptSegment", "bemItemPromoted"]);
	expect(promotion.items[0]).toMatchObject({ id: first.stream!.itemId, text: "Before" });
	expect(promotion.items[1]).toMatchObject({
		realtimeSessionId: "voice-1",
		turnId: "turn-1",
		itemId: "message-1",
		presentation: { type: "inlineMarkdown" },
	});
	expect(state.observe(message(markdown)).items).toEqual([]);
	expect(state.observe(text("Before", true)).items).toEqual([]);
	const next = state.observe(text("After"));
	expect(next.stream!.itemId).not.toBe(first.stream!.itemId);
	expect(state.observe(text("After", true)).items[0]).toMatchObject({ id: next.stream!.itemId, text: "After" });
});

test("continuation emits its own start on the first subsequent delta", () => {
	const state = fixture();
	state.observe(text("Before"));
	state.observe(message(markdown));
	const next = state.observe(text("After"));
	expect(next.stream?.startedItem).toMatchObject({ id: next.stream!.itemId, text: "" });
	expect(state.observe(text("BeforeAfter", true)).items[0].text).toBe("After");
});

test.each([
	{ value: markdown, expected: [{ type: "inlineMarkdown" }] },
	{ value: `  [FINAL] ${markdown}`, expected: [{ type: "inlineMarkdown" }] },
	{ value: `[anything]\n${markdown}`, expected: [{ type: "inlineMarkdown" }] },
	{ value: "::codex-realtime-inline{}", expected: [] },
	{ value: "::codex-realtime-inline{} \nFixture", expected: [] },
	{ value: "::codex-realtime-inline{}\r\nFixture", expected: [{ type: "inlineMarkdown" }] },
	{ value: "::codex-realtime-inline{}\rFixture", expected: [] },
	{
		value: "::codex-inline-vis{}\nvisualize{}",
		expected: [
			{ type: "inlineVisualization", index: 0 },
			{ type: "inlineVisualization", index: 1 },
		],
	},
	{ value: "```\n::codex-inline-vis{}\n```\n  visualize{}", expected: [{ type: "inlineVisualization", index: 0 }] },
	{ value: "~~~fixture\nvisualize{}\n~~~", expected: [] },
	{ value: `${markdown}\n::codex-inline-vis{}`, expected: [{ type: "inlineMarkdown" }] },
])("presentation matches pinned line/fence behavior: $value", ({ value, expected }) => {
	expect(
		fixture()
			.observe(message(value))
			.items.map(item => item.presentation),
	).toEqual([...expected]);
});

test("streamed directives promote once across partial and completed source events", () => {
	const state = fixture();
	const delta = (value: string) =>
		state.observe({ type: "textDelta", turnId: "turn-1", itemId: "stream-1", delta: value });
	expect(delta("::codex-realtime-inline{}").items).toEqual([]);
	expect(delta("\n").items).toHaveLength(1);
	expect(delta("Fixture").items).toEqual([]);
	expect(state.observe(message(markdown, true, "stream-1")).items).toEqual([]);
});

test.each(["user", "assistant"] as const)("seals simultaneous speech in first-active order: %s", first => {
	const state = fixture();
	const second = first === "user" ? "assistant" : "user";
	state.observe({ type: "transcript", role: first, text: "First", done: false });
	state.observe({ type: "transcript", role: second, text: "Second", done: false });
	expect(
		state
			.observe(message(markdown))
			.items.slice(0, 2)
			.map(item => item.role),
	).toEqual([first, second]);
});

test.each([false, true])("ordinary user input seals speech before the source item, completed=%s", completed => {
	const state = fixture();
	state.observe(text("Spoken"));
	const result = state.observe({
		type: "item",
		turnId: "turn-1",
		completed,
		item: { type: "userMessage", id: "input", content: [{ type: "text", text: "Typed work" }] },
	});
	expect(result.before).toBe(true);
	expect(result.items[0]).toMatchObject({ type: "transcriptSegment", text: "Spoken" });
	expect(state.observe(text("Spoken", true)).items).toEqual([]);
});

test("a single wrapped voice delegation leaves the speech segment open", () => {
	const state = fixture();
	state.observe(text("Spoken"));
	const result = state.observe({
		type: "item",
		turnId: "turn-1",
		completed: true,
		item: {
			type: "userMessage",
			id: "input",
			content: [{ type: "text", text: " <realtime_delegation>Work</realtime_delegation> " }],
		},
	});
	expect(result.items).toEqual([]);
	expect(state.observe(text("Spoken", true)).items[0].text).toBe("Spoken");
});

test("late completion retains the original voice identity across closure and a new call", () => {
	const state = fixture();
	state.observe({ type: "close" });
	state.observe({ type: "turnCompleted", turnId: "turn-1" });
	state.observe({ type: "start", sessionId: "voice-2" });
	expect(state.observe(message(markdown)).items[0].realtimeSessionId).toBe("voice-1");
	state.observe({ type: "turnStarted", turnId: "turn-2" });
	expect(
		state.observe({ ...message(markdown, true, "second"), turnId: "turn-2" } as TimelineInput).items[0]
			.realtimeSessionId,
	).toBe("voice-2");
});

test("handoffs retain FIFO call identity when the backing turn starts after voice ends", () => {
	const state = fixture();
	state.observe({ type: "handoff" });
	state.observe({ type: "close" });
	state.observe({ type: "turnCompleted", turnId: "turn-1" });
	state.observe({ type: "start", sessionId: "voice-2" });
	state.observe({ type: "turnStarted", turnId: "late" });
	expect(state.observe({ ...message(markdown), turnId: "late" } as TimelineInput).items[0].realtimeSessionId).toBe(
		"voice-1",
	);
});

test.each([undefined, "turn-1", "unrelated"])("aborted turn association follows pinned identity: %s", turnId => {
	const state = new VoiceTimeline();
	state.observe({ type: "turnStarted", turnId: "turn-1" });
	state.observe({ type: "turnAborted", turnId });
	state.observe({ type: "start", sessionId: "voice-1" });
	expect(state.observe(message(markdown)).items).toHaveLength(turnId === "unrelated" ? 1 : 0);
});

test.each([
	{ item: { type: "imageGeneration" }, completed: false, active: false, promoted: true },
	{ item: { type: "extension", kind: "image_gen.generation" }, completed: false, active: false, promoted: true },
	{ item: { type: "subAgentActivity", kind: "started" }, completed: true, active: false, promoted: true },
	{ item: { type: "subAgentActivity", kind: "completed" }, completed: true, active: true, promoted: false },
	{
		item: { type: "dynamicToolCall", status: "completed", success: true },
		completed: true,
		active: true,
		promoted: true,
	},
	{
		item: { type: "dynamicToolCall", status: "completed", success: true },
		completed: true,
		active: false,
		promoted: false,
	},
	{
		item: { type: "dynamicToolCall", status: "completed", success: false },
		completed: true,
		active: true,
		promoted: false,
	},
	{
		item: { type: "dynamicToolCall", status: "inProgress", success: true },
		completed: false,
		active: true,
		promoted: false,
	},
	{
		item: { type: "mcpToolCall", server: "codex_app", status: "completed" },
		completed: true,
		active: true,
		promoted: true,
	},
	{
		item: { type: "mcpToolCall", server: "example", status: "completed" },
		completed: true,
		active: true,
		promoted: false,
	},
	{ item: { type: "commandExecution", status: "completed" }, completed: true, active: true, promoted: false },
	{ item: { type: "fileChange", status: "completed" }, completed: true, active: true, promoted: false },
])("whole-item promotion: $item, completed=$completed active=$active", ({ item, completed, active, promoted }) => {
	const state = fixture();
	if (!active) state.observe({ type: "close" });
	expect(
		state
			.observe({ type: "item", turnId: "turn-1", item: { ...item, id: "tool" }, completed })
			.items.map(item => item.presentation),
	).toEqual(promoted ? [{ type: "wholeItem" }] : []);
});

test("empty deltas, final-only text, repeated starts and failure closure follow the source reducer", () => {
	const state = fixture();
	expect(state.observe({ type: "start", sessionId: "voice-1" }).items).toEqual([]);
	expect(state.observe(text("")).stream?.startedItem).toMatchObject({ text: "" });
	expect(state.observe(text("Repeated final", true)).items).toEqual([]);
	expect(state.observe(text("Final only", true)).items[0].text).toBe("Final only");
	state.observe({ type: "error" });
	expect(state.observe({ type: "close" }).items[0].outcome).toBe("failed");
	expect(state.observe({ type: "close" }).items).toEqual([]);
	expect(state.observe(text("Late")).items).toEqual([]);
});
