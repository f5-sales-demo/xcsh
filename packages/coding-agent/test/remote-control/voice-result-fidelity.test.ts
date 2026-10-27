import { expect, test } from "bun:test";
import { VoiceResultFidelity, voiceResultInstructions } from "../../src/remote-control/voice-result-fidelity";

const result = "This project contains:\n- `arithmetic.test.ts`\n- `package.json`\n- `README.md`";
const expected = ["arithmetic.test.ts", "package.json", "README.md"];

test("captured backend result retains every filename in the spoken-result instruction", () => {
	const output = voiceResultInstructions(result);
	expect(output.names).toEqual(expected);
	expect(output.text).toContain(result);
	expect(output.text).toContain(JSON.stringify(expected));
	expect(output.text).toContain("extensions");
});
test("captured abbreviated speech fails against the verified handoff", () => {
	const check = new VoiceResultFidelity();
	check.expect("task-1", expected);
	expect(check.observe("assistant", " I see arithmetic test, package, and readme.", true)).toBeNull();
	expect(check.close()).toEqual({
		delegationId: "task-1",
		outcome: "omitted",
		expectedCount: 3,
		missingCount: 3,
	});
});
test("all fragmented spoken separator forms retain exact identifier components", () => {
	const speech = "arithmetic dot test dot ts, package dot json, and README dot md";
	for (let i = 0; i <= speech.length; i++) {
		const check = new VoiceResultFidelity();
		check.expect("task", expected);
		expect(check.observe("assistant", speech.slice(0, i), false)).toBeNull();
		expect(check.observe("assistant", speech.slice(i), false)).toBeNull();
		expect(check.observe("assistant", speech, true)?.outcome).toBe("matched");
	}
});
test("caller correction retires an unanswered list without consuming the next answer", () => {
	const check = new VoiceResultFidelity();
	check.expect("old", expected);
	expect(check.observe("user", "Actually stop reading that list", true)?.outcome).toBe("superseded");
	expect(check.observe("assistant", "Okay", true)).toBeNull();
});
test("duplicate final and a later repetition cannot retroactively repair omission", () => {
	const check = new VoiceResultFidelity();
	check.expect("task", expected);
	expect(check.observe("assistant", "Three files", true)).toBeNull();
	expect(check.observe("user", "Please repeat that", true)?.outcome).toBe("superseded");
	expect(check.observe("assistant", result, true)).toBeNull();
});
test("shorter identifiers cannot match inside longer names", () => {
	const check = new VoiceResultFidelity();
	check.expect("task", ["demo-lb-123"]);
	expect(check.observe("assistant", "demo lb 1234", true)).toBeNull();
	expect(check.close()?.outcome).toBe("omitted");
});
test("ordinary prose, mixed lists, and truncated backend results remain unchanged", () => {
	for (const text of [
		"The context is ready.",
		"- `README.md`: explanation",
		"- `README.md`\n- Read the file",
		"- `README.md`\n…output truncated…",
	])
		expect(voiceResultInstructions(text)).toEqual({ text, names: [] });
});
test("result metadata remains bounded and Unicode identifiers survive", () => {
	const text = "- `résumé.md`\n- `目录.ts`";
	const output = voiceResultInstructions(text);
	expect(output.names).toEqual(["résumé.md", "目录.ts"]);
	expect(Buffer.byteLength(output.text)).toBeLessThan(1900);
	const long = Array.from({ length: 100 }, (_, i) => `- \`file-${i}.ts\``).join("\n");
	expect(voiceResultInstructions(long)).toEqual({ text: long, names: [] });
});

test("closing an unanswered list records incomplete evidence without replay", () => {
	const check = new VoiceResultFidelity();
	check.expect("task", ["README.md"]);
	check.observe("assistant", "Let me", false);
	expect(check.close()).toEqual({ delegationId: "task", outcome: "incomplete", expectedCount: 1, missingCount: 1 });
	expect(check.close()).toBeNull();
});

test("answer text matching an identifier only as a prefix does not pass", () => {
	const check = new VoiceResultFidelity();
	check.expect("task", ["demo-lb"]);
	expect(check.observe("assistant", "demo-lb-extra", true)).toBeNull();
	expect(check.close()?.outcome).toBe("omitted");
});

test("sentence punctuation after a complete identifier remains valid", () => {
	const check = new VoiceResultFidelity();
	check.expect("task", ["README.md"]);
	expect(check.observe("assistant", "The file is README.md.", true)?.outcome).toBe("matched");
});

test("captured list across five assistant segments is evaluated after every segment", () => {
	const check = new VoiceResultFidelity();
	check.expect("task", ["demo-first", "demo-second", "demo-third", "demo-fourth", "demo-last"]);
	for (const name of ["demo-first", "demo-second", "demo-third", "demo-fourth"])
		expect(check.observe("assistant", name + ",", true)).toBeNull();
	expect(check.observe("assistant", "demo-last.", true)).toEqual({
		delegationId: "task",
		outcome: "matched",
		expectedCount: 5,
		missingCount: 0,
	});
	expect(check.close()).toBeNull();
});

test("an incomplete first speech segment is not immediately classified as omitted", () => {
	const check = new VoiceResultFidelity();
	check.expect("task", ["first.ts", "last.ts"]);
	expect(check.observe("assistant", "first.ts,", true)).toBeNull();
	expect(check.close()?.outcome).toBe("omitted");
});

test("a caller interruption preserves partial list evidence without false completion", () => {
	const check = new VoiceResultFidelity();
	check.expect("task", ["first.ts", "last.ts"]);
	expect(check.observe("assistant", "first.ts,", true)).toBeNull();
	expect(check.observe("user", "sorry", false)).toEqual({
		delegationId: "task",
		outcome: "superseded",
		expectedCount: 2,
		missingCount: 1,
	});
	expect(check.observe("assistant", "last.ts", true)).toBeNull();
});

test("duplicate segment finals do not consume or overwrite the remaining list", () => {
	const check = new VoiceResultFidelity();
	check.expect("task", ["first.ts", "last.ts"]);
	expect(check.observe("assistant", "first.ts", true, "segment-one")).toBeNull();
	expect(check.observe("assistant", "first.ts", true, "segment-one")).toBeNull();
	expect(check.observe("assistant", "last.ts", true, "segment-two")?.outcome).toBe("matched");
});

test("a new verified result retains the previous unfinished result outcome", () => {
	const check = new VoiceResultFidelity();
	check.expect("old", ["first.ts", "last.ts"]);
	check.observe("assistant", "first.ts", true);
	expect(check.expect("new", ["new.ts"])).toEqual({
		delegationId: "old",
		outcome: "omitted",
		expectedCount: 2,
		missingCount: 1,
	});
	expect(check.observe("assistant", "new.ts", true)?.delegationId).toBe("new");
});

test("saved review plans receive brief spoken-summary guidance without losing detail", () => {
	const plan =
		"<proposed_plan>\n# Deployment review\n\n" +
		"Preserve ownership and resolve missing inputs.\n".repeat(30) +
		"</proposed_plan>";
	const output = voiceResultInstructions(plan);
	expect(output.text).toContain("one or two short sentences");
	expect(output.text).toContain("Plan card");
	expect(output.text).toContain(plan);
	expect(output.names).toEqual([]);
});
test("quoted and incomplete plan markers do not change normal result instructions", () => {
	for (const text of ["```xml\n<proposed_plan>\nExample\n</proposed_plan>\n```", "<proposed_plan>\nunfinished"])
		expect(voiceResultInstructions(text)).toEqual({ text, names: [] });
});
