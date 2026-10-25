import template from "../prompts/system/remote-voice-pronunciation.md" with { type: "text" };

/** Project ordinary product prose for speech; quoted values, code and identifiers retain exact bytes. */
export function voiceSpeechText(text: string): string {
	const protectedText =
		/(```[\s\S]*?(?:```|$)|`[^`]*(?:`|$)|"[^"\n]*(?:"|$)|“[^”\n]*(?:”|$)|(?:https?:\/\/|xcsh:\/\/|\/)[^\s]+|[\p{L}\p{N}_.-]*xcsh(?:[\p{L}\p{N}_/-][\p{L}\p{N}_./-]*|\.[\p{L}\p{N}][\p{L}\p{N}_./-]*))|(?<![\p{L}\p{N}_/.-])xcsh(?![\p{L}\p{N}_/-]|\.[\p{L}\p{N}])/giu;
	return text.replace(protectedText, (value, protectedValue: string | undefined) =>
		protectedValue ? value : "ek-see-shell",
	);
}

/** Reassert compiled speech guidance; durable backend text is recorded before this projection. */
export function voicePronunciationInstructions(text: string): string {
	return /(?<![\p{L}\p{N}_])xcsh(?![\p{L}\p{N}_])/iu.test(text)
		? `${template.trim()}\nVerified backend text:\n${voiceSpeechText(text)}`
		: text;
}
