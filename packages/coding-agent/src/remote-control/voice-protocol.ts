/** Ported from Codex rust-v0.153.4 realtime protocols. See NOTICE.md and LICENSE. */
import { ProtocolError } from "./session";
import { handoffOptions } from "./voice-handoff";
export type VoiceVersion = "v1" | "v2" | "v3";
export const voices = {
	v1: ["juniper", "maple", "spruce", "ember", "vale", "breeze", "arbor", "sol", "cove"],
	v2: ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"],
	defaultV1: "cove",
	defaultV2: "marin",
};
/** Pinned mode instructions are optional strings with an 8192 estimated-token cap. */
export function voiceInstructions(params: Record<string, unknown>) {
	for (const name of ["realtimeStartInstructions", "realtimeEndInstructions"])
		if (
			params[name] != null &&
			(typeof params[name] !== "string" || Buffer.byteLength(params[name] as string) > 32768)
		)
			throw new ProtocolError(-32602, "Invalid realtime mode instructions");
	return {
		start: typeof params.realtimeStartInstructions === "string" ? params.realtimeStartInstructions : undefined,
		end: typeof params.realtimeEndInstructions === "string" ? params.realtimeEndInstructions : undefined,
	};
}
export function existingCallConfig(params: Record<string, unknown>) {
	voiceInstructions(params);
	handoffOptions(params);
	const transport = params.transport as { type?: unknown; callId?: unknown } | undefined;
	if (transport?.type !== "existingCall")
		throw new ProtocolError(-32602, "This native voice gate requires a client-created call");
	const callId = transport.callId;
	if (
		typeof callId !== "string" ||
		!callId ||
		callId.length > 1024 ||
		[".", ".."].includes(callId) ||
		/[\x00-\x1f]/.test(callId)
	)
		throw new ProtocolError(-32602, "Invalid realtime call identity");
	const version = params.version ?? "v1";
	if (version !== "v1" && version !== "v3")
		throw new ProtocolError(-32602, "Existing calls require realtime v1 or v3");
	if (params.outputModality !== "audio") throw new ProtocolError(-32602, "Realtime v1 and v3 require audio output");
	if (
		params.includeStartupContext !== false ||
		"prompt" in params ||
		params.model != null ||
		params.voice != null ||
		params.delegationAckFiller != null ||
		(params.initialItems != null && (!Array.isArray(params.initialItems) || params.initialItems.length > 0))
	)
		throw new ProtocolError(
			-32602,
			"Existing-call configuration belongs to the client; startup overrides are unsupported",
		);
	if (
		params.realtimeSessionId != null &&
		(typeof params.realtimeSessionId !== "string" ||
			params.realtimeSessionId.length > 256 ||
			/[\r\n]/.test(params.realtimeSessionId))
	)
		throw new ProtocolError(-32602, "Invalid realtime session identity");
	return {
		kind: "existingCall" as const,
		version: version as VoiceVersion,
		callId,
		url:
			version === "v3"
				? `wss://api.openai.com/v1/live/${encodeURIComponent(callId)}`
				: `wss://api.openai.com/v1/realtime?intent=quicksilver&call_id=${encodeURIComponent(callId)}`,
		realtimeSessionId: typeof params.realtimeSessionId === "string" ? params.realtimeSessionId : null,
		clientManagedHandoffs: params.clientManagedHandoffs === true,
	};
}
export function contextChunks(text: string): string[] {
	const chunks: string[] = [];
	let chunk = "",
		bytes = 0;
	for (const character of text) {
		const size = Buffer.byteLength(character);
		if (bytes + size > 500) {
			chunks.push(chunk);
			chunk = "";
			bytes = 0;
		}
		chunk += character;
		bytes += size;
	}
	if (chunk || !chunks.length) chunks.push(chunk);
	return chunks;
}
export type VoiceEvent =
	| { kind: "transcript"; done: boolean; role: "user" | "assistant"; text: string; id?: string }
	| { kind: "delegation"; id: string; itemId?: string; text: string }
	| { kind: "noop"; id: string; itemId: string }
	| { kind: "sessionUpdated"; id: string }
	| { kind: "responseCreated"; id?: string }
	| { kind: "responseDone"; id?: string }
	| { kind: "responseCancelled"; id?: string }
	| { kind: "speechStarted"; itemId?: string }
	| { kind: "itemAdded"; item: Record<string, unknown> }
	| {
			kind: "audio";
			data: string;
			itemId?: string;
			sampleRate: number;
			numChannels: number;
			samplesPerChannel?: number;
	  }
	| { kind: "error" };
function object(value: unknown): Record<string, any> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
/** Match serde_json's unsigned integer conversion followed by Rust's checked narrowing. */
function unsigned(value: unknown, maximum: number): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= maximum;
}
export function decodeVoiceEvent(version: VoiceVersion, input: unknown): VoiceEvent | null {
	const p = object(input);
	if (!p || typeof p.type !== "string") return null;
	if (p.type === "error") return { kind: "error" };
	if (p.type === "session.updated") {
		const session = object(p.session);
		return typeof session?.id === "string" ? { kind: "sessionUpdated", id: session.id } : null;
	}
	if (version === "v3") {
		const item = object(p.item),
			turn = object(p.turn);
		if (["input_transcript.added", "output_transcript.added"].includes(p.type) && typeof item?.text === "string")
			return {
				kind: "transcript",
				done: false,
				role: p.type === "input_transcript.added" ? "user" : "assistant",
				text: item.text,
			};
		if (
			p.type === "turn.done" &&
			(turn?.role === "user" || turn?.role === "assistant") &&
			typeof turn.transcript === "string"
		)
			return {
				kind: "transcript",
				done: true,
				role: turn.role,
				text: turn.transcript,
				...(typeof turn.id === "string" ? { id: turn.id } : {}),
			};
		if (
			p.type === "delegation.created" &&
			item?.type === "delegation" &&
			item.target === "client" &&
			typeof item.id === "string" &&
			item.id &&
			Array.isArray(item.content)
		) {
			const text = item.content
				.filter((c: any) => c?.type === "input_text" && typeof c.text === "string")
				.map((c: any) => c.text)
				.join("");
			return text.trim() ? { kind: "delegation", id: item.id, text } : null;
		}
		if (p.type === "output_audio.delta" && typeof p.audio === "string")
			return { kind: "audio", data: p.audio, sampleRate: 24000, numChannels: 1 };
	} else {
		const transcriptTypes: Record<string, ["user" | "assistant", boolean]> = {
			"conversation.input_transcript.delta": ["user", false],
			"conversation.item.input_audio_transcription.delta": ["user", false],
			"conversation.input_transcript.turn_marked": ["user", true],
			"conversation.item.input_audio_transcription.completed": ["user", true],
			"conversation.output_transcript.delta": ["assistant", false],
			"response.output_text.delta": ["assistant", false],
			"response.output_audio_transcript.delta": ["assistant", false],
			"response.output_audio_transcript.done": ["assistant", true],
			"response.output_text.done": ["assistant", true],
		};
		const shape = transcriptTypes[p.type];
		if (shape) {
			const [role, done] = shape,
				text = p[done ? (p.type === "response.output_text.done" ? "text" : "transcript") : "delta"];
			if (typeof text === "string")
				return {
					kind: "transcript",
					role,
					done,
					text,
					...(typeof p.item_id === "string" ? { id: p.item_id } : {}),
				};
		}
		if (
			version === "v1" &&
			p.type === "conversation.handoff.requested" &&
			typeof p.handoff_id === "string" &&
			p.handoff_id &&
			typeof p.item_id === "string" &&
			typeof p.input_transcript === "string"
		)
			return { kind: "delegation", id: p.handoff_id, itemId: p.item_id, text: p.input_transcript };
		if (version === "v2" && p.type === "conversation.item.done") {
			const item = object(p.item);
			if (item?.type === "function_call" && item.name === "background_agent") {
				const id = typeof item.call_id === "string" ? item.call_id : item.id;
				if (typeof id !== "string" || !id) return null;
				let text = typeof item.arguments === "string" ? item.arguments : "";
				try {
					const args = object(JSON.parse(text));
					for (const key of ["input_transcript", "input", "text", "prompt", "query"])
						if (typeof args?.[key] === "string" && args[key].trim()) {
							text = args[key].trim();
							break;
						}
				} catch {}
				return { kind: "delegation", id, itemId: typeof item.id === "string" ? item.id : id, text };
			}
			if (item?.type === "function_call" && item.name === "remain_silent") {
				const id = typeof item.call_id === "string" ? item.call_id : item.id;
				if (typeof id !== "string" || !id) return null;
				return { kind: "noop", id, itemId: typeof item.id === "string" ? item.id : id };
			}
		}
		if (version === "v2" && ["conversation.item.added", "conversation.item.created"].includes(p.type)) {
			const item = object(p.item);
			return item ? { kind: "itemAdded", item } : null;
		}
		if (version === "v2" && p.type === "input_audio_buffer.speech_started")
			return { kind: "speechStarted", ...(typeof p.item_id === "string" ? { itemId: p.item_id } : {}) };
		if (version === "v2" && ["response.created", "response.done", "response.cancelled"].includes(p.type)) {
			const response = object(p.response);
			const id =
				typeof response?.id === "string"
					? response.id
					: typeof p.response_id === "string"
						? p.response_id
						: undefined;
			return {
				kind:
					p.type === "response.created"
						? "responseCreated"
						: p.type === "response.done"
							? "responseDone"
							: "responseCancelled",
				...(id ? { id } : {}),
			};
		}
		if (version === "v2" && ["response.output_audio.delta", "response.audio.delta"].includes(p.type)) {
			if (typeof p.delta !== "string") return null;
			const channels = p.channels ?? p.num_channels;
			return {
				kind: "audio",
				data: p.delta,
				...(typeof p.item_id === "string" ? { itemId: p.item_id } : {}),
				sampleRate: unsigned(p.sample_rate, 0xffffffff) ? p.sample_rate : 24000,
				numChannels: unsigned(channels, 0xffff) ? channels : 1,
				...(unsigned(p.samples_per_channel, 0xffffffff) ? { samplesPerChannel: p.samples_per_channel } : {}),
			};
		}
		if (version === "v1" && p.type === "conversation.output_audio.delta") {
			const data = typeof p.delta === "string" ? p.delta : p.data;
			// The pinned parser falls back only when the channels key is absent, not null/invalid.
			const channels = Object.hasOwn(p, "channels") ? p.channels : p.num_channels;
			if (typeof data === "string" && unsigned(p.sample_rate, 0xffffffff) && unsigned(channels, 0xffff))
				return {
					kind: "audio",
					data,
					sampleRate: p.sample_rate,
					numChannels: channels,
					...(unsigned(p.samples_per_channel, 0xffffffff) ? { samplesPerChannel: p.samples_per_channel } : {}),
				};
		}
	}
	return null;
}
