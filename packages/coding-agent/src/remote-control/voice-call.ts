/** Pinned Codex realtime_call.rs backend request shape; selected ChatGPT subscription only. */
import { prompt } from "@f5-sales-demo/pi-utils";
import defaultInstructions from "../prompts/system/remote-voice.md" with { type: "text" };
import contextTemplate from "../prompts/system/remote-voice-context.md" with { type: "text" };
import type { SubscriptionAuth } from "./enrollment";
import { ProtocolError } from "./session";
import { handoffOptions } from "./voice-handoff";
import { voiceInstructions, voices } from "./voice-protocol";
export function voiceCallConfig(params: Record<string, unknown>, context: string) {
	voiceInstructions(params);
	handoffOptions(params);
	const transport = params.transport as { type?: unknown; sdp?: unknown } | undefined;
	if (
		transport?.type !== "webrtc" ||
		typeof transport.sdp !== "string" ||
		!transport.sdp.startsWith("v=0") ||
		Buffer.byteLength(transport.sdp) > 262_144
	)
		throw new ProtocolError(-32602, "Invalid realtime SDP offer");
	const version = params.version ?? "v1";
	if ((version !== "v1" && version !== "v3") || params.outputModality !== "audio")
		throw new ProtocolError(-32602, "WebRTC requires realtime v1 or v3 audio");
	const initialItems = params.initialItems ?? [];
	if (
		!Array.isArray(initialItems) ||
		initialItems.length > 128 ||
		initialItems.some(
			item => !item || !["user", "assistant", "developer"].includes(item.role) || typeof item.text !== "string",
		) ||
		initialItems.reduce((bytes, item) => bytes + Buffer.byteLength(item.text), 0) > 32768
	)
		throw new ProtocolError(-32602, "Invalid or excessive realtime initial history");
	if (version === "v1" && initialItems.length)
		throw new ProtocolError(-32602, "Initial realtime items require realtime v3");
	const model = params.model ?? (version === "v1" ? "gpt-realtime-1.5" : "gpt-live-1-codex"),
		voice = params.voice ?? "cove";
	if (
		typeof model !== "string" ||
		!model ||
		model.length > 256 ||
		typeof voice !== "string" ||
		!voices.v1.includes(voice)
	)
		throw new ProtocolError(-32602, "Invalid realtime model or voice");
	if (params.prompt != null && (typeof params.prompt !== "string" || Buffer.byteLength(params.prompt) > 262_144))
		throw new ProtocolError(-32602, "Invalid realtime instructions");
	if (
		params.realtimeSessionId != null &&
		(typeof params.realtimeSessionId !== "string" ||
			params.realtimeSessionId.length > 256 ||
			/[\r\n]/.test(params.realtimeSessionId))
	)
		throw new ProtocolError(-32602, "Invalid realtime session identity");
	const instructions = prompt
		.render(contextTemplate, {
			instructions: params.prompt === undefined ? prompt.render(defaultInstructions) : (params.prompt ?? ""),
			context: params.includeStartupContext === false ? "" : context.slice(-32768),
		})
		.trim();
	return {
		version,
		sdp: transport.sdp,
		session:
			version === "v1"
				? {
						type: "quicksilver",
						model,
						instructions,
						audio: { input: { format: { type: "audio/pcm", rate: 24000 } }, output: { voice } },
					}
				: {
						model,
						instructions,
						audio: { output: { voice } },
						delegation: {
							type: "client",
							...(typeof params.delegationAckFiller === "boolean"
								? { ack_filler: params.delegationAckFiller }
								: {}),
						},
						...(initialItems.length
							? {
									initial_items: initialItems.map(item => ({
										type: "message",
										role: item.role,
										content: [
											{ type: item.role === "assistant" ? "output_text" : "input_text", text: item.text },
										],
									})),
								}
							: {}),
					},
	};
}
export async function createVoiceCall(
	config: ReturnType<typeof voiceCallConfig>,
	auth: SubscriptionAuth,
	extraHeaders: Record<string, string>,
	fetcher: typeof fetch = fetch,
	signal?: AbortSignal,
): Promise<{ sdp: string; callId: string }> {
	let response: Response;
	try {
		response = await fetcher(
			"https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas",
			{
				method: "POST",
				redirect: "error",
				signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
				headers: {
					...extraHeaders,
					Authorization: `Bearer ${auth.accessToken}`,
					"ChatGPT-Account-Id": auth.accountId,
					originator: "xcsh",
					"Content-Type": "application/json",
					"openai-alpha": "quicksilver=v2",
				},
				body: JSON.stringify({ sdp: config.sdp, session: config.session }),
			},
		);
	} catch {
		throw new ProtocolError(-32000, "Native realtime call transport failed");
	}
	if (!response.ok) {
		await response.body?.cancel();
		throw new ProtocolError(-32000, `Native realtime call failed (HTTP ${response.status})`);
	}
	const location = response.headers.get("location")?.split("?")[0] ?? "";
	const callId = location
		.split("/")
		.reverse()
		.find(
			part =>
				/^rtc_[a-zA-Z0-9_-]+$/.test(part) || /^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/.test(part),
		);
	if (!callId) {
		await response.body?.cancel();
		throw new ProtocolError(-32000, "Native realtime call response omitted its identity");
	}
	const reader = response.body?.getReader();
	if (!reader) throw new ProtocolError(-32000, "Native realtime call response omitted SDP");
	let bytes = 0;
	const chunks: Uint8Array[] = [];
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.length;
			if (bytes > 262_144) throw new Error();
			chunks.push(value);
		}
	} catch {
		await reader.cancel().catch(() => {});
		throw new ProtocolError(-32000, "Invalid realtime call response");
	}
	const sdp = Buffer.concat(chunks).toString("utf8");
	if (!sdp.startsWith("v=0")) throw new ProtocolError(-32000, "Invalid realtime answer SDP");
	return { sdp, callId };
}
