/** Ported from pinned context/realtime_delegation.rs. See NOTICE.md and LICENSE. */
import { prompt } from "@f5-sales-demo/pi-utils";
import template from "../prompts/system/remote-voice-delegation.md" with { type: "text" };

function bounded(value: string, tail: boolean): string {
	const escaped = value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
	const bytes = Buffer.from(escaped);
	if (bytes.length <= 4096) return escaped;
	if (tail) {
		let start = bytes.length - 4093;
		while ((bytes[start] & 0xc0) === 0x80) start++;
		return `…${bytes.subarray(start).toString("utf8")}`;
	}
	let end = 4093;
	while ((bytes[end] & 0xc0) === 0x80) end--;
	return `${bytes.subarray(0, end).toString("utf8")}…`;
}
export function voiceDelegation(input: string, transcript: string | null = null, tail = false): string {
	return prompt
		.render(template, {
			input: bounded(input, false),
			transcript: transcript ? bounded(transcript, true) : undefined,
			tail,
		})
		.trimEnd();
}
