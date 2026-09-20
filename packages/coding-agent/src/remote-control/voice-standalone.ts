/** Single OpenAI Live WebSocket configuration for standalone realtime voice. */

import { ProtocolError } from "./session";
import { handoffOptions } from "./voice-handoff";
import type { VoicePersonaSnapshot } from "./voice-persona";
import { voicePersonaInstructions } from "./voice-persona";
import { defaultVoice, requireLiveVersion, voiceInstructions, voices } from "./voice-protocol";

function initialItems(params: Record<string, unknown>) {
	const items = params.initialItems ?? [];
	if (
		!Array.isArray(items) ||
		items.length > 128 ||
		items.some(
			item => !item || !["user", "assistant", "developer"].includes(item.role) || typeof item.text !== "string",
		) ||
		items.reduce((bytes, item) => bytes + Buffer.byteLength(item.text), 0) > 32768
	)
		throw new ProtocolError(-32602, "Invalid or excessive realtime initial history");
	return items as { role: "user" | "assistant" | "developer"; text: string }[];
}

export function standaloneVoiceConfig(params: Record<string, unknown>, persona: VoicePersonaSnapshot) {
	voiceInstructions(params);
	handoffOptions(params);
	requireLiveVersion(params.version);
	const transport = params.transport as { type?: unknown } | null | undefined;
	if (transport != null && transport.type !== "websocket")
		throw new ProtocolError(-32602, "Invalid standalone realtime transport");
	if (params.outputModality !== "audio") throw new ProtocolError(-32602, "Live realtime requires audio output");
	const model = params.model ?? "gpt-live-1-codex";
	if (typeof model !== "string" || !model || model.length > 256)
		throw new ProtocolError(-32602, "Invalid realtime model");
	const voice = params.voice ?? defaultVoice;
	if (typeof voice !== "string" || !voices.includes(voice)) throw new ProtocolError(-32602, "Invalid realtime voice");
	if (params.prompt != null && (typeof params.prompt !== "string" || Buffer.byteLength(params.prompt) > 262_144))
		throw new ProtocolError(-32602, "Invalid realtime instructions");
	const items = initialItems(params);
	const instructions = voicePersonaInstructions(params, persona).instructions;
	const realtimeSessionId = params.realtimeSessionId ?? params.threadId ?? null;
	if (
		realtimeSessionId != null &&
		(typeof realtimeSessionId !== "string" || realtimeSessionId.length > 256 || /[\r\n]/.test(realtimeSessionId))
	)
		throw new ProtocolError(-32602, "Invalid realtime session identity");
	const url = new URL("wss://api.openai.com/v1/live");
	url.searchParams.set("model", model);
	return {
		kind: "websocket" as const,
		url: url.toString(),
		alpha: "quicksilver=v2",
		realtimeSessionId: realtimeSessionId as string | null,
		clientManagedHandoffs: params.clientManagedHandoffs === true,
		session: {
			instructions,
			audio: { output: { voice } },
			delegation: {
				type: "client",
				...(typeof params.delegationAckFiller === "boolean" ? { ack_filler: params.delegationAckFiller } : {}),
			},
			...(items.length
				? {
						initial_items: items.map(item => ({
							type: "message",
							role: item.role,
							content: [{ type: item.role === "assistant" ? "output_text" : "input_text", text: item.text }],
						})),
					}
				: {}),
		},
	};
}
