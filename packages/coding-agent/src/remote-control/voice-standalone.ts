/** Pinned Codex 0.153.4 standalone realtime WebSocket configuration. */
import { prompt } from "@f5-sales-demo/pi-utils";
import defaultInstructions from "../prompts/system/remote-voice.md" with { type: "text" };
import contextTemplate from "../prompts/system/remote-voice-context.md" with { type: "text" };
import { ProtocolError } from "./session";
import { handoffOptions } from "./voice-handoff";
import { type VoiceVersion, voiceInstructions, voices } from "./voice-protocol";

const agentDescription =
	"Send a user request to the background agent. Use this as the default action. Do not rephrase the user's ask or rewrite it in your own words; pass along the user's own words. If the background agent is idle, this starts a new task and returns the final result to the user. If the background agent is already working on a task, this sends the request as guidance to steer that previous task. If the user asks to do something next, later, after this, or once current work finishes, call this tool so the work is actually queued instead of merely promising to do it later.";
const silenceDescription =
	"Call this when the best response is to say nothing. Use it instead of speaking after hidden system/control messages, after background agent updates in silent modes, or whenever acknowledging aloud would be distracting. This tool has no user-visible effect.";

function instructions(params: Record<string, unknown>, context: string): string {
	if (params.prompt != null && (typeof params.prompt !== "string" || Buffer.byteLength(params.prompt) > 262_144))
		throw new ProtocolError(-32602, "Invalid realtime instructions");
	return prompt
		.render(contextTemplate, {
			instructions: params.prompt === undefined ? prompt.render(defaultInstructions) : (params.prompt ?? ""),
			context: params.includeStartupContext === false ? "" : context.slice(-32768),
		})
		.trim();
}

function initialItems(params: Record<string, unknown>, version: VoiceVersion) {
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
	if (version !== "v3" && items.length) throw new ProtocolError(-32602, "Initial realtime items require realtime v3");
	return items as { role: "user" | "assistant" | "developer"; text: string }[];
}

export function standaloneVoiceConfig(params: Record<string, unknown>, context: string) {
	voiceInstructions(params);
	handoffOptions(params);
	const transport = params.transport as { type?: unknown } | null | undefined;
	if (transport != null && transport.type !== "websocket")
		throw new ProtocolError(-32602, "Invalid standalone realtime transport");
	const version = (params.version ?? "v2") as VoiceVersion;
	if (!["v1", "v2", "v3"].includes(version)) throw new ProtocolError(-32602, "Invalid realtime version");
	const outputModality = params.outputModality;
	if (outputModality !== "audio" && outputModality !== "text")
		throw new ProtocolError(-32602, "Invalid realtime output modality");
	if (version !== "v2" && outputModality === "text")
		throw new ProtocolError(-32602, "Text realtime output requires realtime v2");
	const model = params.model ?? (version === "v3" ? "gpt-live-1-codex" : "gpt-realtime-1.5");
	if (typeof model !== "string" || !model || model.length > 256)
		throw new ProtocolError(-32602, "Invalid realtime model");
	const voice = params.voice ?? (version === "v2" ? voices.defaultV2 : voices.defaultV1);
	const allowedVoices = version === "v2" ? voices.v2 : voices.v1;
	if (typeof voice !== "string" || !allowedVoices.includes(voice))
		throw new ProtocolError(-32602, "Invalid realtime voice");
	const items = initialItems(params, version);
	const sessionInstructions = instructions(params, context);
	const realtimeSessionId = params.realtimeSessionId ?? params.threadId ?? null;
	if (
		realtimeSessionId != null &&
		(typeof realtimeSessionId !== "string" || realtimeSessionId.length > 256 || /[\r\n]/.test(realtimeSessionId))
	)
		throw new ProtocolError(-32602, "Invalid realtime session identity");
	const url = new URL(version === "v3" ? "wss://api.openai.com/v1/live" : "wss://api.openai.com/v1/realtime");
	if (version === "v1") url.searchParams.set("intent", "quicksilver");
	url.searchParams.set("model", model);
	const input = { format: { type: "audio/pcm", rate: 24000 } };
	const session =
		version === "v1"
			? { type: "quicksilver", instructions: sessionInstructions, audio: { input, output: { voice } } }
			: version === "v2"
				? {
						type: "realtime",
						instructions: sessionInstructions,
						output_modalities: [outputModality],
						audio: {
							input: {
								...input,
								noise_reduction: { type: "near_field" },
								transcription: { model: "gpt-4o-mini-transcribe" },
								turn_detection: {
									type: "server_vad",
									interrupt_response: true,
									create_response: true,
									silence_duration_ms: 500,
								},
							},
							output: { format: { type: "audio/pcm", rate: 24000 }, voice },
						},
						tools: [
							{
								type: "function",
								name: "background_agent",
								description: agentDescription,
								parameters: {
									type: "object",
									properties: {
										prompt: {
											type: "string",
											description: "The user request to delegate to the background agent.",
										},
									},
									required: ["prompt"],
									additionalProperties: false,
								},
							},
							{
								type: "function",
								name: "remain_silent",
								description: silenceDescription,
								parameters: { type: "object", properties: {}, additionalProperties: false },
							},
						],
						tool_choice: "auto",
					}
				: {
						instructions: sessionInstructions,
						audio: { output: { voice } },
						delegation: {
							type: "client",
							...(typeof params.delegationAckFiller === "boolean"
								? { ack_filler: params.delegationAckFiller }
								: {}),
						},
						...(items.length
							? {
									initial_items: items.map(item => ({
										type: "message",
										role: item.role,
										content: [
											{ type: item.role === "assistant" ? "output_text" : "input_text", text: item.text },
										],
									})),
								}
							: {}),
					};
	return {
		kind: "websocket" as const,
		version,
		url: url.toString(),
		alpha: version === "v1" ? "quicksilver=v1" : version === "v3" ? "quicksilver=v2" : undefined,
		realtimeSessionId: realtimeSessionId as string | null,
		clientManagedHandoffs: params.clientManagedHandoffs === true,
		session,
	};
}
