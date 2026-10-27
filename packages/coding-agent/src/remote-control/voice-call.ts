/** Pinned Codex realtime_call.rs backend request shape; selected ChatGPT subscription only. */

import type { SubscriptionAuth } from "./enrollment";
import { ProtocolError } from "./session";
import { LIVE_MODEL } from "./voice-contract-evidence";
import { handoffOptions } from "./voice-handoff";
import type { VoicePersonaSnapshot } from "./voice-persona";
import { voicePersonaInstructions } from "./voice-persona";
import { defaultVoice, requireLiveVersion, voiceInstructions, voices } from "./voice-protocol";

/** A rejected request admits no call; transport/response uncertainty must remain reserved. */
export class VoiceCallCreationError extends ProtocolError {
	constructor(
		readonly outcome: "rejected" | "uncertain",
		message: string,
		readonly callId?: string,
	) {
		super(-32000, message);
	}
}

async function rejectedCreationField(response: Response): Promise<string | null> {
	if (!response.body) return null;
	const reader = response.body.getReader();
	try {
		const chunks: Uint8Array[] = [];
		let size = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > 4096) return null;
			chunks.push(value);
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		const detail = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).detail;
		if (typeof detail !== "string") return null;
		// Report only known field names from the captured provider rejection.
		// Never expose arbitrary server text or retry an ambiguous creation.
		return (
			/^Field `session\.(model|instructions|audio\.output\.voice|delegation|initial_items)` is not allowed for this Codex realtime session$/.exec(
				detail,
			)?.[1] ?? null
		);
	} catch {
		return null;
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
export function voiceCallConfig(params: Record<string, unknown>, persona: VoicePersonaSnapshot) {
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
	requireLiveVersion(params.version);
	if (params.outputModality !== "audio") throw new ProtocolError(-32602, "WebRTC Live requires audio output");
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
	const model = params.model ?? LIVE_MODEL,
		voice = params.voice ?? defaultVoice;
	if (model !== LIVE_MODEL || typeof voice !== "string" || !voices.includes(voice))
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
	const instructions = voicePersonaInstructions(params, persona).instructions;
	return {
		sdp: transport.sdp,
		session: {
			model,
			instructions,
			audio: { output: { voice } },
			delegation: {
				type: "client",
				ack_filler: params.delegationAckFiller === true,
			},
			...(initialItems.length
				? {
						initial_items: initialItems.map(item => ({
							type: "message",
							role: item.role,
							content: [{ type: item.role === "assistant" ? "output_text" : "input_text", text: item.text }],
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
	const session: Record<string, unknown> = { ...config.session };
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
				body: JSON.stringify({ sdp: config.sdp, session }),
			},
		);
	} catch {
		throw new VoiceCallCreationError("uncertain", "Native realtime call transport failed");
	}
	if (response.status !== 201) {
		const field = response.status === 400 ? await rejectedCreationField(response) : null;
		if (response.status !== 400) await response.body?.cancel();
		throw new VoiceCallCreationError(
			[400, 401, 403, 404, 413, 415, 422, 429].includes(response.status) ? "rejected" : "uncertain",
			`Native realtime call failed (HTTP ${response.status}${field ? `; rejected field session.${field}` : ""})`,
		);
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
		throw new VoiceCallCreationError("uncertain", "Native realtime call response omitted its identity");
	}
	const reader = response.body?.getReader();
	if (!reader) throw new VoiceCallCreationError("uncertain", "Native realtime call response omitted SDP", callId);
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
		throw new VoiceCallCreationError("uncertain", "Invalid realtime call response", callId);
	}
	const sdp = Buffer.concat(chunks).toString("utf8");
	if (!sdp.startsWith("v=0")) throw new VoiceCallCreationError("uncertain", "Invalid realtime answer SDP", callId);
	return { sdp, callId };
}
