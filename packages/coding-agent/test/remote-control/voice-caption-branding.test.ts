import { expect, test } from "bun:test";
import { VoiceCaptionBranding } from "../../src/remote-control/voice-caption-branding";

test("captured phonetic identity is displayed with canonical branding", () => {
	const format = new VoiceCaptionBranding();
	expect(format.append(" I’m ek-see-shell.")).toBe(" I’m ");
	expect(format.complete(" I’m ek-see-shell.")).toBe(" I’m xcsh.");
});

test("every caption split produces the same name without partial phonetic text", () => {
	const text = "I’m ek-see-shell. I can help with xcsh.";
	for (let split = 0; split <= text.length; split++) {
		const format = new VoiceCaptionBranding();
		const first = format.append(text.slice(0, split));
		const second = format.append(text.slice(split));
		expect(first + second).toBe("I’m xcsh. I can help with xcsh.");
		expect(first).not.toMatch(/\bek(?:-see)?-?$/);
		expect(format.complete(text)).toBe("I’m xcsh. I can help with xcsh.");
	}
});

test("space spelling and letter case use the same branding", () => {
	for (const text of ["I’m ek see shell.", "I’m EK-SEE-SHELL.", "I’m XC Shell."]) {
		const format = new VoiceCaptionBranding();
		expect(format.complete(text)).toBe("I’m xcsh.");
	}
});

test("a prefix that becomes another word is released unchanged", () => {
	const format = new VoiceCaptionBranding();
	expect(format.append("This ek")).toBe("This ");
	expect(format.append("ed out a result.")).toBe("eked out a result.");
	expect(format.complete("This eked out a result.")).toBe("This eked out a result.");
});

test("complete phonetic name at end waits for a boundary or completion", () => {
	const format = new VoiceCaptionBranding();
	expect(format.append("I’m ek-see-shell")).toBe("I’m ");
	expect(format.complete("I’m ek-see-shell")).toBe("I’m xcsh");
});

test("word extensions and file names are not rewritten", () => {
	for (const text of ["ek-see-shelling", "read ek-see-shell.ts", "path/ek-see-shell", "use ek-see-shell_v2"]) {
		const format = new VoiceCaptionBranding();
		expect(format.complete(text)).toBe(text);
	}
});

test("reset does not carry a partial spelling into another assistant turn", () => {
	const format = new VoiceCaptionBranding();
	format.append("ek-see-");
	format.reset();
	expect(format.append("shell is a word.")).toBe("shell is a word.");
});

test("streamed file/path prefixes remain unchanged across every split", () => {
	for (const text of ["read ek-see-shell.ts", "path/ek-see-shell", "ek-see-shell_v2"])
		for (let split = 0; split <= text.length; split++) {
			const format = new VoiceCaptionBranding();
			const combined = format.append(text.slice(0, split)) + format.append(text.slice(split));
			expect(combined).toBe(text);
		}
});

test("each branded occurrence is delivered once in consecutive turns", () => {
	const format = new VoiceCaptionBranding();
	expect(format.append("ek-see-shell and ek see shell ")).toBe("xcsh and xcsh ");
	expect(format.finish("ek-see-shell and ek see shell ")).toEqual({ text: "xcsh and xcsh ", delta: "" });
	expect(format.append("ek-see-shell")).toBe("");
	expect(format.finish("ek-see-shell")).toEqual({ text: "xcsh", delta: "xcsh" });
});
