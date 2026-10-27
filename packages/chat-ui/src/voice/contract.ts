import { isInteractionCommand } from "../interactions/transport";
/** xcsh metadata stays outside the pinned provider wire schemas. */
export type VoiceAction =
	| "capabilities"
	| "start"
	| "stop"
	| "companion"
	| "mute"
	| "unmute"
	| "pause"
	| "resume"
	| "interrupt"
	| "devices"
	| "playback"
	| "text"
	| "history"
	| "interaction"
	| "cancel";
export interface VoiceRequest {
	type: "voice_request";
	requestId: string;
	clientId?: string;
	action: VoiceAction;
	chatId?: string;
	sdp?: string;
	takeoverRevision?: number;
	/** Cleanup cannot authorize reconciliation of a persisted call. */
	cleanup?: boolean;
	announcementId?: string;
	announcementRevision?: number;
	text?: string;
	command?: import("../interactions/transport").InteractionCommand;
	turnId?: string;
}
export interface VoiceFrame {
	type: "voice_event";
	clientId?: string;
	chatId: string;
	method: string;
	params: Record<string, unknown>;
	requestId?: string;
}
const object = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);
export function isVoiceRequest(value: unknown): value is VoiceRequest {
	if (
		!object(value) ||
		value.type !== "voice_request" ||
		typeof value.requestId !== "string" ||
		!/^[A-Za-z0-9:_-]{1,128}$/.test(value.requestId) ||
		![
			"capabilities",
			"start",
			"stop",
			"companion",
			"mute",
			"unmute",
			"pause",
			"resume",
			"interrupt",
			"devices",
			"playback",
			"text",
			"history",
			"interaction",
			"cancel",
		].includes(String(value.action))
	)
		return false;
	if (value.cleanup !== undefined && (value.action !== "stop" || typeof value.cleanup !== "boolean")) return false;
	if (value.action === "capabilities") return true;
	if (typeof value.chatId !== "string" || value.chatId.length > 256) return false;
	if (value.action === "text")
		return typeof value.text === "string" && value.text.trim().length > 0 && value.text.length <= 65_536;
	if (value.action === "interaction") return isInteractionCommand(value.command);
	if (value.action === "cancel") return typeof value.turnId === "string" && value.turnId.length <= 256;
	if (value.action === "playback")
		return (
			typeof value.announcementId === "string" &&
			Number.isSafeInteger(value.announcementRevision) &&
			Number(value.announcementRevision) >= 0
		);
	return (
		value.action !== "start" ||
		(typeof value.sdp === "string" &&
			value.sdp.startsWith("v=0") &&
			value.sdp.length <= 262_144 &&
			(value.takeoverRevision === undefined ||
				(Number.isSafeInteger(value.takeoverRevision) && Number(value.takeoverRevision) > 0)))
	);
}
export function isVoiceFrame(value: unknown): value is VoiceFrame {
	return (
		object(value) &&
		value.type === "voice_event" &&
		typeof value.chatId === "string" &&
		typeof value.method === "string" &&
		value.method.length <= 128 &&
		object(value.params)
	);
}
export type VoiceState =
	| "Connecting"
	| "Listening"
	| "Speaking"
	| "Working"
	| "Needs input"
	| "Muted"
	| "Closing"
	| "Error";

export interface VoiceClosureReceipt {
	confirmed: boolean;
	seconds?: number;
	usageConfirmed?: boolean;
	reason?: string;
}
/** Optional provider echoes may be absent, but supplied evidence must agree with its call. */
export function voiceClosureReceipt(value: unknown, expectedSessionId?: string): VoiceClosureReceipt | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const event = value as {
		type?: unknown;
		usage?: { seconds?: unknown };
		reason?: unknown;
		session?: { id?: unknown };
	};
	if (event.type !== "session.closed") return undefined;
	// The subscription may omit the snapshot or ID echo. A supplied echo must
	// agree with the accepted call bound to this transport, never the chat ID.
	if (
		event.session !== undefined &&
		(!event.session || typeof event.session !== "object" || Array.isArray(event.session))
	)
		return undefined;
	if (
		event.session?.id !== undefined &&
		(typeof event.session.id !== "string" ||
			!event.session.id ||
			(expectedSessionId !== undefined && event.session.id !== expectedSessionId))
	)
		return undefined;
	const seconds = event.usage?.seconds;
	if (event.usage !== undefined && (!event.usage || typeof event.usage !== "object" || Array.isArray(event.usage)))
		return undefined;
	if (seconds !== undefined && (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0))
		return undefined;
	return {
		confirmed: true,
		...(typeof seconds === "number" ? { seconds } : { usageConfirmed: false }),
		...(typeof event.reason === "string" && /^[a-z_]{1,64}$/.test(event.reason) ? { reason: event.reason } : {}),
	};
}
