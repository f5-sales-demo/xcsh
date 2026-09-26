/** Native WebRTC and existing-call sideband; AgentSession remains the sole executor. */
import { createHash, randomUUID } from "node:crypto";
import { prompt } from "@f5-sales-demo/pi-utils";
import tailTemplate from "../prompts/system/remote-voice-tail.md" with { type: "text" };
import type { RealtimeModeInstructions } from "../session/realtime-context";
import type { SubscriptionAuth } from "./enrollment";
import { ProtocolError } from "./session";
import { createVoiceCall, voiceCallConfig } from "./voice-call";
import { voiceDelegation } from "./voice-delegation";
import {
	type HandoffPhase,
	handoffChannel,
	handoffOptions,
	handoffPhase,
	VoiceHandoff,
	type VoiceOutputUpdate,
} from "./voice-handoff";
import { VoiceHistory } from "./voice-history";
import { CompletedVoiceHandoff, completedVoiceText } from "./voice-output";
import { type VoicePersonaSnapshot, voicePersonaInstructions } from "./voice-persona";
import {
	CODEX_LIVE_VERSION,
	contextChunks,
	existingCallConfig,
	inspectVoiceEvent,
	type VoiceEvent,
	type VoiceEventRejection,
	voiceInstructions,
} from "./voice-protocol";
import { openVoiceSocket, type VoiceHandlers, type VoiceSocket } from "./voice-socket";
import { standaloneVoiceConfig } from "./voice-standalone";

export interface VoiceDependencies {
	/** Shared by successive calls attached to one backing session. */
	history?: VoiceHistory;
	authenticate(): Promise<SubscriptionAuth>;
	authenticateApiKey?(): Promise<string | undefined>;
	createCall?: typeof createVoiceCall;
	persona?(): VoicePersonaSnapshot | Promise<VoicePersonaSnapshot>;
	modeChanged?(active: boolean, instructions: RealtimeModeInstructions): Promise<void>;
	open?(url: string, headers: Record<string, string>, handlers: VoiceHandlers): Promise<VoiceSocket>;
	emit(method: string, params: Record<string, unknown>): void;
	records(): Record<string, unknown>[];
	record(record: Record<string, unknown>): Promise<void>;
	title?(text: string): void;
	delegate(id: string, text: string, output?: (update: VoiceOutputUpdate) => void): Promise<string>;
}
function connectionFailure(error: unknown): "http" | "upgradeRejected" | "closed" | "timeout" | "transport" {
	const message = error instanceof Error ? error.message : "";
	if (/upgrade rejected/i.test(message)) return "upgradeRejected";
	if (/\b(400|401|403|404|408|410|429|500|502|503|504)\b/.test(message)) return "http";
	if (/timeout|timed out/i.test(message)) return "timeout";
	if (/closed/i.test(message)) return "closed";
	return "transport";
}
function safeConnectionError(error: unknown): string {
	const status =
		error instanceof Error
			? error.message.match(/\b(400|401|403|404|408|410|429|500|502|503|504)\b/)?.[1]
			: undefined;
	return `Native realtime connection failed${status ? ` (HTTP ${status})` : ""}`;
}
export class NativeVoice {
	#handoff?: VoiceHandoff | CompletedVoiceHandoff;
	#activeHandoffId?: string;
	#handoffOptions = handoffOptions({});
	#history?: VoiceHistory;
	#closing?: Promise<void>;
	#ready = false;
	#openingInputs: string[] = [];
	#openingBytes = 0;
	#tail: { role: "user" | "assistant"; text: string; done: boolean }[] = [];
	#newTranscriptEntry: Record<"user" | "assistant", boolean> = { user: false, assistant: false };
	#promotedFinal = new Map<string, string>();
	#flushTail = false;
	#abort = new AbortController();
	#modeInstructions: RealtimeModeInstructions = {};
	#modeStarted = false;
	#modeUpdates: Promise<void> = Promise.resolve();
	#started = false;
	#socket?: VoiceSocket;
	#config?: ReturnType<typeof existingCallConfig> | ReturnType<typeof standaloneVoiceConfig>;
	#state: "idle" | "opening" | "open" | "reconnecting" | "closed" = "idle";
	#epoch = 0;
	#connectedAt = 0;
	#rapidDisconnects = 0;
	#reconnectAttempts = 0;
	#reconnectTimer?: ReturnType<typeof setTimeout>;
	#outbound: string[] = [];
	#outboundBytes = 0;
	#chain = Promise.resolve();
	#pendingBytes = 0;
	#seen = new Set<string>();
	#eventTypes = new Map<string, number>();
	#eventRejections = new Map<VoiceEventRejection | "invalidJson" | "droppedFrame", number>();
	#firstEventRecorded = false;
	#diagnosticsTail: Promise<void> = Promise.resolve();
	#startedAt = 0;
	#pendingDelegations = 0;
	#awaitingSession = false;
	#sessionReady?: { resolve: () => void; reject: (error: Error) => void };
	#persona: VoicePersonaSnapshot = { tools: [], history: "" };
	#handoffsRetired = false;
	constructor(private readonly deps: VoiceDependencies) {}
	get active(): boolean {
		return this.#state === "opening" || this.#state === "open" || this.#state === "reconnecting";
	}
	async start(params: Record<string, unknown>): Promise<void> {
		if (this.#state !== "idle") throw new ProtocolError(-32000, "Voice requires a new attachment after stopping");
		this.#state = "opening";
		this.#startedAt = Date.now();
		let callConfig: ReturnType<typeof voiceCallConfig> | undefined;
		let config: ReturnType<typeof existingCallConfig> | ReturnType<typeof standaloneVoiceConfig> | undefined;
		let instructions: RealtimeModeInstructions;
		let standalone: boolean;
		try {
			this.#handoffOptions = handoffOptions(params);
			const transport = params.transport as { type?: unknown } | undefined;
			standalone = transport == null || transport.type === "websocket";
			this.#persona = (await this.deps.persona?.()) ?? this.#persona;
			if (this.#state !== "opening") throw new Error("Voice stopped during persona snapshot");
			Object.freeze(this.#persona);
			Object.freeze(this.#persona.tools);
			callConfig = transport?.type === "webrtc" ? voiceCallConfig(params, this.#persona) : undefined;
			config = callConfig
				? undefined
				: standalone
					? standaloneVoiceConfig(params, this.#persona)
					: existingCallConfig(params);
			instructions = voiceInstructions(params);
		} catch (error) {
			if (this.#state === "opening") this.#state = "idle";
			throw error;
		}
		this.#flushTail = params.flushTranscriptTailOnSessionEnd === true;
		const records = this.deps.records();
		const prepared = new Set(
			records
				.filter(
					record => record.kind === "delegation" && record.state === "prepared" && typeof record.key === "string",
				)
				.map(record => String(record.key)),
		);
		for (const record of records)
			if (
				typeof record.key === "string" &&
				((record.kind === "delegation" && record.state === "submitted") || record.kind === "delegationResult")
			)
				prepared.delete(record.key);
		this.#seen = new Set(
			records
				.filter(record => typeof record.key === "string" && !prepared.has(String(record.key)))
				.map(record => String(record.key)),
		);
		let stage = "authentication";
		const startedAt = Date.now();
		let stageStartedAt = startedAt;
		let sidebandElapsedMs = 0;
		try {
			const diagnostics = voicePersonaInstructions(params, this.#persona).diagnostics;
			await this.deps.record({ kind: "voicePersonaDiagnostic", ...diagnostics });
			if (this.#state !== "opening") throw new Error("Voice stopped during persona diagnostics");
			const apiKey = standalone ? await this.deps.authenticateApiKey?.() : undefined;
			if (standalone && !apiKey) throw new ProtocolError(-32602, "Realtime conversation requires API key auth");
			const auth = standalone ? undefined : await this.deps.authenticate();
			if (this.#state !== "opening") throw new Error("Voice stopped during authentication");
			await this.deps.record({
				kind: "voiceDiagnostic",
				stage,
				outcome: "succeeded",
				elapsedMs: Date.now() - stageStartedAt,
			});
			// Pinned created calls default to their owning thread; existing calls retain the client's optional identity.
			const sessionId =
				config?.realtimeSessionId ??
				(typeof params.realtimeSessionId === "string"
					? params.realtimeSessionId
					: callConfig && typeof params.threadId === "string"
						? params.threadId
						: null);
			const headers: Record<string, string> = standalone
				? { Authorization: `Bearer ${apiKey}`, originator: "xcsh" }
				: {
						Authorization: `Bearer ${auth!.accessToken}`,
						"ChatGPT-Account-Id": auth!.accountId,
						originator: "xcsh",
						"openai-alpha": "quicksilver=v2",
					};
			if (standalone && config?.kind === "websocket" && config.alpha) headers["openai-alpha"] = config.alpha;
			if (sessionId !== null) headers["x-session-id"] = sessionId;
			if (callConfig) {
				stage = "call-create";
				stageStartedAt = Date.now();
				const call = await (this.deps.createCall ?? createVoiceCall)(
					callConfig,
					auth!,
					headers,
					undefined,
					this.#abort.signal,
				);
				if (this.#state !== "opening") throw new Error("Voice stopped during call creation");
				await this.deps.record({
					kind: "voiceDiagnostic",
					stage,
					outcome: "succeeded",
					elapsedMs: Date.now() - stageStartedAt,
				});
				config = existingCallConfig({
					version: CODEX_LIVE_VERSION,
					realtimeSessionId: sessionId,
					outputModality: "audio",
					includeStartupContext: false,
					clientManagedHandoffs: params.clientManagedHandoffs,
					transport: { type: "existingCall", callId: call.callId },
				});
				this.#config = config;
				this.#started = true;
				this.#history =
					this.deps.history ??
					new VoiceHistory(
						sessionId,
						record => this.deps.record(record),
						(method, params) => this.deps.emit(method, params),
					);
				this.#chain = this.#history.start(sessionId);
				await this.#chain;
				if (!this.active) throw new Error("Voice stopped during history initialization");
				stage = "sdp-delivery";
				stageStartedAt = Date.now();
				this.deps.emit("thread/realtime/started", { realtimeSessionId: sessionId, version: CODEX_LIVE_VERSION });
				this.deps.emit("thread/realtime/sdp", { sdp: call.sdp });
				await this.deps.record({
					kind: "voiceDiagnostic",
					stage,
					outcome: "succeeded",
					elapsedMs: Date.now() - stageStartedAt,
				});
			}
			this.#config = config;
			stage = "sideband-attach";
			stageStartedAt = Date.now();
			const socket = await this.#connect(headers);
			if (this.#state !== "opening") {
				socket.close();
				throw new Error("Voice stopped while connecting");
			}
			this.#socket = socket;
			this.#state = "open";
			this.#connectedAt = Date.now();
			sidebandElapsedMs = Date.now() - stageStartedAt;
			if (standalone && this.#config?.kind === "websocket") {
				this.#awaitingSession = true;
				const ready = new Promise<void>((resolve, reject) => {
					this.#sessionReady = { resolve, reject };
				});
				socket.send(JSON.stringify({ type: "session.update", session: this.#config.session }));
				await ready;
				this.#sessionReady = undefined;
				if (!this.active) throw new Error("Voice stopped during standalone initialization");
			}
			if (!this.#started) {
				this.#started = true;
				this.#history =
					this.deps.history ??
					new VoiceHistory(
						sessionId,
						record => this.deps.record(record),
						(method, params) => this.deps.emit(method, params),
					);
				this.#chain = this.#history.start(sessionId);
				await this.#chain;
				if (!this.active) throw new Error("Voice stopped during history initialization");
				this.deps.emit("thread/realtime/started", { realtimeSessionId: sessionId, version: CODEX_LIVE_VERSION });
			}
			stage = "mode-instructions";
			this.#modeInstructions = instructions;
			this.#modeUpdates = Promise.resolve().then(async () => {
				if (!this.active) return;
				this.#modeStarted = true;
				await this.deps.modeChanged?.(true, { ...this.#modeInstructions });
			});
			await this.#modeUpdates;
			if (!this.active) throw new Error("Voice stopped during mode initialization");
			stage = "sideband-attach";
			await this.deps.record({
				kind: "voiceDiagnostic",
				stage,
				connected: true,
				outcome: "succeeded",
				elapsedMs: sidebandElapsedMs,
			});
			if (!this.active) throw new Error("Voice stopped during connection diagnostics");
			this.#ready = true;
			const openingInputs = this.#openingInputs;
			this.#openingInputs = [];
			this.#openingBytes = 0;
			for (const data of openingInputs) this.#receive(data);
		} catch (error) {
			const message = safeConnectionError(error);
			const status = message.match(/HTTP (\d{3})/)?.[1];
			await this.deps
				.record({
					kind: "voiceDiagnostic",
					stage,
					connected: false,
					failure: connectionFailure(error),
					httpStatus: status ? Number(status) : null,
					elapsedMs: Date.now() - stageStartedAt,
				})
				.catch(() => {});
			if (error instanceof ProtocolError && error.code === -32602) {
				this.#fail(error.message);
				throw error;
			}
			this.#fail(message);
			throw new ProtocolError(-32000, message);
		}
	}
	stop(reason = "requested"): Promise<void> {
		if (this.#state === "closed" || this.#state === "idle") return this.#closing ?? Promise.resolve();
		const socket = this.#socket;
		this.#state = "closed";
		this.#handoff?.close();
		this.#epoch++;
		clearTimeout(this.#reconnectTimer);
		this.#outbound = [];
		this.#outboundBytes = 0;
		this.#openingInputs = [];
		this.#openingBytes = 0;
		this.#awaitingSession = false;
		this.#sessionReady?.reject(new Error("Voice stopped during standalone initialization"));
		this.#sessionReady = undefined;
		this.#abort.abort();
		const endInstructions = this.#modeUpdates
			.catch(() => {})
			.then(async () => {
				if (this.#modeStarted) await this.deps.modeChanged?.(false, { ...this.#modeInstructions });
			})
			.catch(() => {
				this.deps.emit("thread/realtime/error", { message: "Could not apply voice end instructions" });
			});
		this.#socket = undefined;
		if (socket) {
			try {
				if (reason === "requested") socket.send(JSON.stringify({ type: "session.close" }));
			} catch {}
			socket.close();
		}
		this.#closing = Promise.all([this.#chain, endInstructions, this.#diagnosticsTail])
			.then(async () => {
				await this.deps.record({
					kind: "voiceEventDiagnostic",
					eventTypes: Object.fromEntries(
						[...this.#eventTypes].sort(([left], [right]) => left.localeCompare(right)),
					),
					rejections: Object.fromEntries(
						[...this.#eventRejections].sort(([left], [right]) => left.localeCompare(right)),
					),
				});
				await this.#history?.close(reason === "failed");
			})
			.catch(() => {
				this.deps.emit("thread/realtime/error", { message: "Could not persist voice history" });
			})
			.then(() => {
				this.deps.emit("thread/realtime/closed", { reason });
			});
		if (this.#started && this.#flushTail) void this.#closing.then(() => this.#flushTranscriptTail()).catch(() => {});
		return this.#closing;
	}
	#fail(message = "Native realtime transport failed"): void {
		if (!this.active) return;
		this.deps.emit("thread/realtime/error", { message });
		this.stop("failed");
	}
	async #connect(headers: Record<string, string>): Promise<VoiceSocket> {
		const epoch = ++this.#epoch;
		return (this.deps.open ?? openVoiceSocket)(this.#config!.url, headers, {
			message: data => {
				if (this.#epoch === epoch) this.#receive(data);
			},
			closed: () => {
				if (this.#epoch === epoch) this.#transportLost();
			},
		});
	}
	#transportLost(): void {
		if (!this.active || this.#state === "reconnecting") return;
		if (this.#awaitingSession) {
			this.#awaitingSession = false;
			this.#sessionReady?.reject(new Error("Realtime session ended before session.started"));
		}
		if (this.#state !== "open" || this.#config?.kind === "websocket") {
			this.stop("transportClosed");
			return;
		}
		this.#state = "reconnecting";
		this.#epoch++;
		const socket = this.#socket;
		this.#socket = undefined;
		socket?.close();
		// Match the pinned Live sideband's 200 ms exponential backoff, capped at
		// five seconds, and reset after a connection survives thirty seconds.
		if (Date.now() - this.#connectedAt >= 30_000) this.#rapidDisconnects = 0;
		this.#reconnectAttempts = 0;
		this.#scheduleReconnect();
	}
	#scheduleReconnect(): void {
		const delay = Math.min(200 * 2 ** Math.min(this.#rapidDisconnects++, 5), 5000);
		this.#reconnectTimer = setTimeout(() => {
			void this.#reconnect();
		}, delay);
	}
	async #reconnect(): Promise<void> {
		if (this.#state !== "reconnecting") return;
		this.#reconnectAttempts++;
		const startedAt = Date.now();
		try {
			// Selection and refresh stay with the owning session's credential broker.
			const auth = await this.deps.authenticate();
			if (this.#state !== "reconnecting") return;
			const socket = await this.#connect({
				Authorization: `Bearer ${auth.accessToken}`,
				"ChatGPT-Account-Id": auth.accountId,
				originator: "xcsh",
				"openai-alpha": "quicksilver=v2",
				...(this.#config?.realtimeSessionId != null ? { "x-session-id": this.#config.realtimeSessionId } : {}),
			});
			if (this.#state !== "reconnecting") {
				socket.close();
				return;
			}
			this.#socket = socket;
			this.#state = "open";
			this.#connectedAt = Date.now();
			this.#drain();
			await this.deps.record({
				kind: "voiceDiagnostic",
				stage: "sideband-reconnect",
				connected: true,
				elapsedMs: Date.now() - startedAt,
			});
		} catch (error) {
			if (!this.active) return;
			const message = safeConnectionError(error);
			const status = message.match(/HTTP (\d{3})/)?.[1];
			await this.deps
				.record({
					kind: "voiceDiagnostic",
					stage: "sideband-reconnect",
					attempt: this.#reconnectAttempts,
					connected: false,
					failure: connectionFailure(error),
					httpStatus: status ? Number(status) : null,
					elapsedMs: Date.now() - startedAt,
				})
				.catch(() => {});
			if (!this.active) return;
			if (status === "404" || status === "410") this.stop("transportClosed");
			else if (
				(!status || ["408", "429", "500", "502", "503", "504"].includes(status)) &&
				this.#reconnectAttempts < 3
			)
				this.#scheduleReconnect();
			else this.#fail(message);
		}
	}
	#send(message: Record<string, unknown>): void {
		if (this.#state !== "open" && this.#state !== "reconnecting") return;
		const data = JSON.stringify(message);
		const bytes = Buffer.byteLength(data);
		if (this.#outboundBytes + bytes + (this.#socket?.bufferedAmount ?? 0) > 1_048_576) {
			this.#fail("Realtime output buffer limit reached");
			return;
		}
		this.#outbound.push(data);
		this.#outboundBytes += bytes;
		this.#drain();
	}
	#drain(): void {
		while (this.#state === "open" && this.#socket && this.#outbound.length) {
			const data = this.#outbound[0];
			try {
				this.#socket.send(data);
			} catch {
				// Retry only a failed write. Successful writes have no server ACK in
				// this protocol and must not be replayed speculatively.
				this.#transportLost();
				return;
			}
			this.#outbound.shift();
			this.#outboundBytes -= Buffer.byteLength(data);
		}
	}
	appendText(text: unknown, role: unknown = "user", speakable = false): void {
		if (this.#state !== "open" && this.#state !== "reconnecting")
			throw new ProtocolError(-32000, "Voice is not active");
		if (speakable && typeof text === "string" && !text.trim()) return;
		if (
			typeof text !== "string" ||
			!text.trim() ||
			Buffer.byteLength(text) > 65_536 ||
			!["user", "assistant", "developer"].includes(String(role))
		)
			throw new ProtocolError(-32602, "Invalid realtime text input");
		const outputText = speakable ? completedVoiceText(text) : text;
		for (const chunk of contextChunks(outputText))
			this.#send({
				type: "session.context.append",
				...(speakable ? { channel: "speakable" } : {}),
				content: [{ type: "input_text", text: chunk }],
			});
	}
	appendAudio(audio: unknown): void {
		if (this.#state !== "open" || this.#config?.kind !== "websocket")
			throw new ProtocolError(-32602, "Realtime audio input requires standalone WebSocket transport");
		if (!audio || typeof audio !== "object" || Array.isArray(audio))
			throw new ProtocolError(-32602, "Invalid realtime audio input");
		const frame = audio as Record<string, unknown>;
		const unsigned = (value: unknown, maximum: number) =>
			typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= maximum;
		if (
			typeof frame.data !== "string" ||
			!unsigned(frame.sampleRate, 0xffffffff) ||
			!unsigned(frame.numChannels, 0xffff) ||
			(frame.samplesPerChannel != null && !unsigned(frame.samplesPerChannel, 0xffffffff)) ||
			(frame.itemId != null && typeof frame.itemId !== "string")
		)
			throw new ProtocolError(-32602, "Invalid realtime audio input");
		this.#send({
			type: "input_audio.append",
			audio: frame.data,
		});
	}
	#receive(data: string): void {
		if (!this.active) return;
		const bytes = Buffer.byteLength(data);
		if (this.#seen.size >= 8192 || bytes > 1_048_576 || this.#pendingBytes + this.#openingBytes + bytes > 2_097_152) {
			this.#countEvent("invalid", "droppedFrame");
			this.#fail("Realtime input buffer limit reached");
			return;
		}
		if (!this.#ready) {
			if (this.#awaitingSession) {
				let input: unknown;
				try {
					input = JSON.parse(data);
				} catch {
					this.#countEvent("invalid", "invalidJson");
					this.#sessionReady?.reject(new Error("Malformed realtime event before session.started"));
					return;
				}
				const event = this.#inspectEvent(input);
				if (!event) return;
				this.#awaitingSession = false;
				if (event.kind === "sessionUpdated") {
					this.#openingInputs.push(data);
					this.#openingBytes += bytes;
					this.#sessionReady?.resolve();
				} else
					this.#sessionReady?.reject(
						new Error(
							event.kind === "error"
								? "The realtime service reported an error"
								: "Realtime session received an event before session.started",
						),
					);
				return;
			}
			this.#openingInputs.push(data);
			this.#openingBytes += bytes;
			return;
		}
		this.#pendingBytes += bytes;
		this.#chain = this.#chain
			.then(async () => {
				if (!this.#config) return;
				let input: unknown;
				try {
					input = JSON.parse(data);
				} catch {
					this.#countEvent("invalid", "invalidJson");
					this.#fail("Malformed realtime event");
					return;
				}
				const event = this.#inspectEvent(input);
				if (event) await this.#event(event);
			})
			.catch(() => this.#fail())
			.finally(() => {
				this.#pendingBytes -= bytes;
			});
	}
	#countEvent(type: string, rejection?: VoiceEventRejection | "invalidJson" | "droppedFrame"): void {
		this.#eventTypes.set(type, (this.#eventTypes.get(type) ?? 0) + 1);
		if (rejection) this.#eventRejections.set(rejection, (this.#eventRejections.get(rejection) ?? 0) + 1);
	}
	#inspectEvent(input: unknown): VoiceEvent | null {
		const decoded = inspectVoiceEvent(input);
		this.#countEvent(decoded.eventType, decoded.rejection);
		if (decoded.event && !this.#firstEventRecorded) {
			this.#firstEventRecorded = true;
			this.#diagnosticsTail = this.#diagnosticsTail
				.then(() =>
					this.deps.record({
						kind: "voiceDiagnostic",
						stage: "first-event",
						eventType: decoded.eventType,
						elapsedMs: Date.now() - this.#startedAt,
					}),
				)
				.catch(() => {});
		}
		return decoded.event;
	}
	#key(kind: string, id: string): string {
		const connectionId =
			this.#config?.kind === "existingCall" ? this.#config.callId : this.#config?.realtimeSessionId;
		return createHash("sha256")
			.update(JSON.stringify([connectionId, kind, id]))
			.digest("hex");
	}
	#trackTranscript(event: Extract<VoiceEvent, { kind: "transcript" }>): void {
		if (event.done && this.#promotedFinal.get(event.role) === event.text) return;
		if (!event.done) this.#promotedFinal.delete(event.role);
		if (!event.text) return;
		const forceNew = this.#newTranscriptEntry[event.role];
		const last = forceNew ? undefined : this.#tail.findLast(entry => entry.role === event.role);
		if (!last) this.#tail.push({ role: event.role, text: event.text, done: event.done });
		else if (event.done) {
			if (event.text.startsWith(last.text)) last.text = event.text;
			last.done = true;
		} else {
			last.text += event.text;
			last.done = false;
		}
		this.#newTranscriptEntry[event.role] = event.done;
		while (this.#tail.length > 128 || Buffer.byteLength(JSON.stringify(this.#tail)) > 65536) {
			if (this.#tail.length === 1) {
				this.#tail[0].text = this.#tail[0].text.slice(-8192);
				break;
			}
			this.#tail.shift();
		}
	}
	async #flushTranscriptTail(): Promise<void> {
		const tail = this.#tail;
		this.#tail = [];
		if (!tail.some(entry => entry.text.trim())) return;
		// A final assistant transcript means realtime already handled the user's
		// request. Re-submitting that exchange can reopen older interrupted work
		// from the backing session after the voice call closes.
		const lastSpoken = tail.findLast(entry => entry.text.trim());
		if (lastSpoken?.role === "assistant") return;
		const transcript = JSON.stringify(tail.map(({ role, text }) => ({ role, text })));
		const key = this.#key("transcript-tail", transcript);
		if (this.#seen.has(key)) return;
		this.#seen.add(key);
		await this.deps.record({ key, kind: "transcriptTail", transcript });
		const text = await this.deps.delegate(
			key,
			voiceDelegation(
				prompt.render(tailTemplate).trimEnd(),
				tail.map(entry => `${entry.role}: ${entry.text}`).join("\n"),
				true,
			),
		);
		await this.deps.record({ key, kind: "transcriptTailResult", text });
	}

	async #event(event: VoiceEvent): Promise<void> {
		if (event.kind === "error") {
			this.#fail("The realtime service reported an error");
			return;
		}
		if (event.kind === "audio") {
			if (!this.active) return;
			this.deps.emit("thread/realtime/outputAudio/delta", {
				audio: {
					data: event.data,
					sampleRate: event.sampleRate,
					numChannels: event.numChannels,
					samplesPerChannel: null,
					itemId: null,
				},
			});
			return;
		}
		if (event.kind === "sessionUpdated") return;
		if (event.kind === "transcriptBoundary") {
			this.#newTranscriptEntry[event.role] = true;
			return;
		}
		if (event.kind === "transcript") {
			if (event.done) {
				const key = this.#key("transcript", event.id ?? randomUUID());
				if (this.#seen.has(key)) return;
				this.#seen.add(key);
				await this.deps.record({
					key,
					kind: "transcript",
					realtimeSessionId: this.#config?.realtimeSessionId,
					role: event.role,
					text: event.text,
				});
				if (event.role === "user" && event.text.trim())
					try {
						this.deps.title?.(event.text);
					} catch {
						// Title generation is presentation-only and must not fail voice.
					}
			}
			this.#trackTranscript(event);
			await this.#history?.transcript(event.role, event.text, event.done);
			if (!this.active) return;
			this.deps.emit(`thread/realtime/transcript/${event.done ? "done" : "delta"}`, {
				role: event.role,
				[event.done ? "text" : "delta"]: event.text,
			});
			return;
		}
		const key = this.#key("delegation", event.id);
		if (this.#seen.has(key)) return;
		if (this.#pendingDelegations >= 16 || this.#seen.size >= 8192) {
			this.#fail("Realtime delegation limit reached");
			return;
		}
		this.#seen.add(key);
		await this.#history?.observe({ type: "handoff" });
		// Pinned methods.rs appends a missing handoff input before consuming the active transcript.
		const activeTranscript = this.#tail.map(({ role, text }) => ({ role, text }));
		const input = event.text.trim();
		if (input && !activeTranscript.some(entry => entry.role === "user" && entry.text.trim() === input))
			activeTranscript.push({ role: "user", text: input });
		for (const entry of activeTranscript) this.#promotedFinal.set(entry.role, entry.text);
		this.#tail = [];
		this.#newTranscriptEntry = { user: true, assistant: true };
		// Persist before submission: recovery suppresses repeats, including ambiguous
		// interrupted submissions. This is at-most-once; crash-gap reconciliation remains a gate.
		await this.deps.record({
			key,
			kind: "delegation",
			state: "prepared",
			realtimeSessionId: this.#config?.realtimeSessionId,
			text: event.text,
		});
		if (this.active)
			this.deps.emit("thread/realtime/itemAdded", {
				item: {
					type: "handoff_request",
					handoff_id: event.id,
					item_id: event.id,
					input_transcript: event.text,
					active_transcript: activeTranscript,
				},
			});
		if (this.#handoffsRetired) return;
		this.#pendingDelegations++;
		this.#handoff?.close();
		const handoff = this.#createHandoff(event.id);
		this.#handoff = handoff;
		this.#activeHandoffId = event.id;
		const delegated = this.deps.delegate(
			key,
			voiceDelegation(event.text, activeTranscript.map(entry => `${entry.role}: ${entry.text}`).join("\n")),
			update => {
				if (!this.active) return;
				try {
					handoff?.update(update);
				} catch {
					this.#fail("Could not stream the backing agent response");
				}
			},
		);
		await this.deps.record({
			key,
			kind: "delegation",
			state: "submitted",
			realtimeSessionId: this.#config?.realtimeSessionId,
		});
		void delegated
			.then(async text => {
				if (this.#activeHandoffId === event.id) this.#activeHandoffId = undefined;
				await this.deps.record({ key, kind: "delegationResult", text });
				if (this.#config?.clientManagedHandoffs || !this.active) return;
				handoff?.finish(text);
			})
			.catch((error: unknown) => {
				const details = error as { codexErrorInfo?: unknown; voiceHandoffRetired?: unknown } | null;
				if (details?.voiceHandoffRetired === true) return;
				handoff?.close();
				if (details?.codexErrorInfo === "misalignmentPolicyViolation") this.#handoffsRetired = true;
				if (this.active)
					this.deps.emit("thread/realtime/error", {
						message: "The backing agent could not complete the voice request",
					});
			})
			.finally(() => {
				if (this.#activeHandoffId === event.id) this.#activeHandoffId = undefined;
				this.#pendingDelegations--;
			});
	}
	#createHandoff(id: string): VoiceHandoff | CompletedVoiceHandoff | undefined {
		if (this.#config?.clientManagedHandoffs) return;
		if (this.#handoffOptions.asItems)
			return new CompletedVoiceHandoff((text, phase) => this.#sendCompletedOutput(text, phase, id));
		return new VoiceHandoff(this.#handoffOptions, (channel, text) => {
			for (const chunk of contextChunks(text))
				this.#send({
					type: "delegation.context.append",
					delegation_item_id: id,
					...(channel ? { channel } : {}),
					content: [{ type: "input_text", text: chunk }],
				});
		});
	}
	/** Mirror completed backing events; streaming delegation updates retain their existing owner. */
	mirrorText(text: string, phase?: HandoffPhase): void {
		if ((this.#state !== "open" && this.#state !== "reconnecting") || this.#config?.clientManagedHandoffs) return;
		if (!this.#activeHandoffId && !text.trim()) return;
		if (Buffer.byteLength(text) > 1_048_576) {
			this.#fail("Realtime handoff input limit");
			return;
		}
		this.#sendCompletedOutput(text, phase, this.#activeHandoffId);
	}
	#sendCompletedOutput(text: string, phase?: HandoffPhase, handoffId?: string): void {
		const options = this.#handoffOptions;
		if (options.mode === "bemTags") phase = handoffPhase(text, options.prefixes) ?? "final_answer";
		let output = completedVoiceText(text);
		if (options.asItems && options.itemPrefix) output = completedVoiceText(`${options.itemPrefix}\n\n${output}`);
		const channel = handoffChannel(options, phase);
		for (const chunk of contextChunks(output))
			this.#send({
				type: options.asItems || handoffId === undefined ? "session.context.append" : "delegation.context.append",
				...(!options.asItems && handoffId !== undefined ? { delegation_item_id: handoffId } : {}),
				...(channel ? { channel } : {}),
				content: [{ type: "input_text", text: chunk }],
			});
	}
}
