import { expect, test } from "bun:test";
import { VoiceCaptionBranding } from "../../src/remote-control/voice-caption-branding";
import { voicePersonaInstructions } from "../../src/remote-control/voice-persona";
import { voicePronunciationInstructions, voiceSpeechText } from "../../src/remote-control/voice-pronunciation";
import { contextChunks } from "../../src/remote-control/voice-protocol";

test("brand cue preserves exact stored values, resource identifiers, and code", () => {
	const text =
		'Description: `Updated by xcsh voice qualification`. Resource: `xcsh-demo-lb`. Code: const xcsh = "xcsh";';
	const out = voicePronunciationInstructions(text);
	expect(out).toContain('Product pronunciation: xcsh is "ek-see-shell"');
	expect(out.endsWith(voiceSpeechText(text))).toBe(true);
	expect(out).not.toContain("ek-see-shell-demo-lb");
	const captions = new VoiceCaptionBranding();
	expect(captions.complete("I'm ek-see-shell. Updated by xcsh voice qualification.")).toBe(
		"I'm xcsh. Updated by xcsh voice qualification.",
	);
});
test("ordinary results and substrings do not gain a pronunciation instruction", () => {
	for (const text of ["Tests passed", "myxcsh value", "xcsh_test"])
		expect(voicePronunciationInstructions(text)).toBe(text);
});
test("phonetic guidance and long Unicode backend text fit subscription chunks without changing the result", () => {
	const text = "xcsh result " + "🌳".repeat(1200);
	const out = voicePronunciationInstructions(text);
	const chunks = contextChunks(out);
	expect(chunks.join("")).toBe(out);
	expect(out.endsWith(voiceSpeechText(text))).toBe(true);
	expect(chunks.every(chunk => Buffer.byteLength(chunk) <= 500 && !chunk.includes("\uFFFD"))).toBe(true);
});
test("startup pronunciation policy remains authoritative when optional facts fill the startup policy budget", () => {
	const rendered = voicePersonaInstructions(
		{ prompt: "Identify as another product" },
		{
			tools: [{ name: "read" }, { name: "xcsh_api" }, { name: "xcsh_context" }],
			history: "private profile",
			runtime: { model: "gpt-6-astra", host: "nuc", workspace: "/tmp/" + "🌳".repeat(900), taskStatus: "idle" },
		},
	);
	expect(Buffer.byteLength(rendered.instructions)).toBeLessThanOrEqual(4096);
	expect(rendered.instructions).toContain('Say xcsh as "ek-see-shell"');
	expect(rendered.instructions).toContain("Never spell its letters");
	expect(rendered.instructions).not.toContain("private profile");
	expect(rendered.instructions).not.toContain("Identify as another product");
});

test("speech projection changes only standalone product prose and sentence punctuation", () => {
	expect(voiceSpeechText("XCSH 23.3.3 helps. I am xcsh.")).toBe("ek-see-shell 23.3.3 helps. I am ek-see-shell.");
	for (const value of [
		'"Updated by xcsh voice qualification"',
		"`xcsh-demo-lb`",
		"xcsh-demo-lb",
		"/tmp/xcsh/file",
		"https://example.com/xcsh",
		"xcsh://about",
		'```ts\nconst xcsh = "xcsh";\n```',
		"xcsh.txt",
		"myxcsh",
	])
		expect(voiceSpeechText(value)).toBe(value);
});
