/** Native WebRTC and existing-call sideband; AgentSession remains the sole executor. */
import { createHash, randomUUID } from "node:crypto";
import { prompt } from "@f5-sales-demo/pi-utils";
import tailTemplate from "../prompts/system/remote-voice-tail.md" with { type: "text" };
import type { SubscriptionAuth } from "./enrollment";
import { ProtocolError } from "./session";
import { createVoiceCall, voiceCallConfig } from "./voice-call";
import { VoiceHistory } from "./voice-history";
import { contextChunks, decodeVoiceEvent, existingCallConfig, type VoiceEvent } from "./voice-protocol";

import { openVoiceSocket, type VoiceHandlers, type VoiceSocket } from "./voice-socket";

export interface VoiceDependencies {
	authenticate(): Promise<SubscriptionAuth>;
	createCall?: typeof createVoiceCall;
	context?(): string;
	instructions?(phase: "start" | "end", text: string): Promise<void>;
	open?(url: string, headers: Record<string, string>, handlers: VoiceHandlers): Promise<VoiceSocket>;
	emit(method: string, params: Record<string, unknown>): void;
	records(): Record<string, unknown>[];
	record(record: Record<string, unknown>): Promise<void>;
	delegate(id: string, text: string): Promise<string>;
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
	#history?: VoiceHistory;
	#closing?: Promise<void>;
	#ready = false;
	#openingInputs: string[] = [];
	#openingBytes = 0;
	#tail: { role: "user" | "assistant"; text: string; done: boolean }[] = [];
	#promotedFinal = new Map<string, string>();
	#flushTail = false;
	#abort = new AbortController();
	#endInstructions?: string;
	#started = false;
	#socket?: VoiceSocket;
	#config?: ReturnType<typeof existingCallConfig>;
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
	#pendingDelegations = 0;
	constructor(private readonly deps: VoiceDependencies) {}
	get active(): boolean {
		return this.#state === "opening" || this.#state === "open" || this.#state === "reconnecting";
	}
	async start(params: Record<string, unknown>): Promise<void> {
		if (this.#state !== "idle") throw new ProtocolError(-32000, "Voice requires a new attachment after stopping");
		const transport = params.transport as { type?: unknown } | undefined;
		const callConfig =
			transport?.type === "webrtc" ? voiceCallConfig(params, this.deps.context?.() ?? "") : undefined;
		let config = callConfig ? undefined : existingCallConfig(params);
		this.#state = "opening";
		this.#flushTail = params.flushTranscriptTailOnSessionEnd === true;
		this.#seen = new Set(
			this.deps
				.records()
				.filter(record => typeof record.key === "string")
				.map(record => String(record.key)),
		);
		let stage = "authentication";
		const startedAt = Date.now();
		try {
			const auth = await this.deps.authenticate();
			if (this.#state !== "opening") throw new Error("Voice stopped during authentication");
			const version = callConfig ? "v3" : config!.version;
			const sessionId = typeof params.realtimeSessionId === "string" ? params.realtimeSessionId : null;
			const headers: Record<string, string> = {
				Authorization: `Bearer ${auth.accessToken}`,
				"ChatGPT-Account-Id": auth.accountId,
				originator: "xcsh",
				"openai-alpha": version === "v3" ? "quicksilver=v2" : "quicksilver=v1",
			};
			if (sessionId) headers["x-session-id"] = sessionId;
			if (callConfig) {
				stage = "call-create";
				const call = await (this.deps.createCall ?? createVoiceCall)(
					callConfig,
					auth,
					headers,
					undefined,
					this.#abort.signal,
				);
				if (this.#state !== "opening") throw new Error("Voice stopped during call creation");
				config = existingCallConfig({
					version,
					realtimeSessionId: sessionId,
					outputModality: "audio",
					includeStartupContext: false,
					clientManagedHandoffs: params.clientManagedHandoffs,
					transport: { type: "existingCall", callId: call.callId },
				});
				this.#config = config;
				if (typeof params.realtimeStartInstructions === "string" && params.realtimeStartInstructions)
					await this.deps.instructions?.("start", params.realtimeStartInstructions);
				this.#endInstructions =
					typeof params.realtimeEndInstructions === "string" ? params.realtimeEndInstructions : undefined;
				this.#started = true;
				this.#history = new VoiceHistory(
					sessionId,
					record => this.deps.record(record),
					(method, params) => this.deps.emit(method, params),
				);
				this.#chain = this.#history.start();
				await this.#chain;
				if (!this.active) throw new Error("Voice stopped during history initialization");
				this.deps.emit("thread/realtime/started", { realtimeSessionId: sessionId, version });
				this.deps.emit("thread/realtime/sdp", { sdp: call.sdp });
			}
			this.#config = config;
			stage = "sideband-attach";
			const socket = await this.#connect(headers);
			if (this.#state !== "opening") {
				socket.close();
				throw new Error("Voice stopped while connecting");
			}
			this.#socket = socket;
			this.#state = "open";
			this.#connectedAt = Date.now();
			if (!this.#started) {
				this.#started = true;
				this.#history = new VoiceHistory(
					sessionId,
					record => this.deps.record(record),
					(method, params) => this.deps.emit(method, params),
				);
				this.#chain = this.#history.start();
				await this.#chain;
				if (!this.active) throw new Error("Voice stopped during history initialization");
				this.deps.emit("thread/realtime/started", { realtimeSessionId: sessionId, version });
			}
			await this.deps.record({ kind: "voiceDiagnostic", stage, connected: true, elapsedMs: Date.now() - startedAt });
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
					elapsedMs: Date.now() - startedAt,
				})
				.catch(() => {});
			this.#fail(message);
			throw new ProtocolError(-32000, message);
		}
	}
	stop(reason = "requested"): Promise<void> {
		if (this.#state === "closed" || this.#state === "idle") return this.#closing ?? Promise.resolve();
		const socket = this.#socket;
		this.#state = "closed";
		this.#epoch++;
		clearTimeout(this.#reconnectTimer);
		this.#outbound = [];
		this.#outboundBytes = 0;
		this.#openingInputs = [];
		this.#openingBytes = 0;
		this.#abort.abort();
		if (this.#started && this.#endInstructions)
			void this.deps.instructions?.("end", this.#endInstructions).catch(() => {});
		this.#socket = undefined;
		if (socket) {
			try {
				if (reason === "requested" && this.#config?.version === "v3")
					socket.send(JSON.stringify({ type: "session.close" }));
			} catch {}
			socket.close();
		}
		this.#closing = this.#chain
			.then(async () => {
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
		if (this.#state !== "open" || this.#config?.version !== "v3") {
			this.stop("transportClosed");
			return;
		}
		this.#state = "reconnecting";
		this.#epoch++;
		const socket = this.#socket;
		this.#socket = undefined;
		socket?.close();
		// Match the pinned v3 sideband's 200 ms exponential backoff, capped at
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
				...(this.#config?.realtimeSessionId ? { "x-session-id": this.#config.realtimeSessionId } : {}),
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
		if (
			typeof text !== "string" ||
			!text.trim() ||
			Buffer.byteLength(text) > 65_536 ||
			!["user", "assistant", "developer"].includes(String(role))
		)
			throw new ProtocolError(-32602, "Invalid realtime text input");
		if (this.#config?.version === "v3") {
			for (const chunk of contextChunks(text))
				this.#send({
					type: "session.context.append",
					...(speakable ? { channel: "speakable" } : {}),
					content: [{ type: "input_text", text: chunk }],
				});
		} else {
			if (speakable) throw new ProtocolError(-32602, "Speakable context requires realtime v3");
			this.#send({
				type: "conversation.item.create",
				item: {
					type: "message",
					role,
					content: [{ type: role === "assistant" ? "output_text" : "input_text", text }],
				},
			});
		}
	}
	#receive(data: string): void {
		if (!this.active) return;
		const bytes = Buffer.byteLength(data);
		if (this.#seen.size >= 8192 || bytes > 1_048_576 || this.#pendingBytes + this.#openingBytes + bytes > 2_097_152) {
			this.#fail("Realtime input buffer limit reached");
			return;
		}
		if (!this.#ready) {
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
					this.#fail("Malformed realtime event");
					return;
				}
				const event = decodeVoiceEvent(this.#config.version, input);
				if (event) await this.#event(event);
			})
			.catch(() => this.#fail())
			.finally(() => {
				this.#pendingBytes -= bytes;
			});
	}
	#key(kind: string, id: string): string {
		return createHash("sha256")
			.update(JSON.stringify([this.#config?.callId, kind, id]))
			.digest("hex");
	}
	#trackTranscript(event: Extract<VoiceEvent, { kind: "transcript" }>): void {
		if (event.done && this.#promotedFinal.get(event.role) === event.text) return;
		if (!event.done) this.#promotedFinal.delete(event.role);
		const last = this.#tail.at(-1);
		if (!last || last.role !== event.role || last.done)
			this.#tail.push({ role: event.role, text: event.text, done: event.done });
		else {
			last.text = event.done ? event.text : last.text + event.text;
			last.done = event.done;
		}
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
		const transcript = JSON.stringify(tail.map(({ role, text }) => ({ role, text })));
		const key = this.#key("transcript-tail", transcript);
		if (this.#seen.has(key)) return;
		this.#seen.add(key);
		await this.deps.record({ key, kind: "transcriptTail", transcript });
		const text = await this.deps.delegate(key, prompt.render(tailTemplate, { transcript }));
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
		// Pinned methods.rs appends a missing handoff input before consuming the active transcript.
		const activeTranscript = this.#tail.map(({ role, text }) => ({ role, text }));
		const input = event.text.trim();
		if (input && !activeTranscript.some(entry => entry.role === "user" && entry.text.trim() === input))
			activeTranscript.push({ role: "user", text: input });
		for (const entry of activeTranscript) this.#promotedFinal.set(entry.role, entry.text);
		this.#tail = [];
		// Persist before submission: recovery suppresses repeats, including ambiguous
		// interrupted submissions. This is at-most-once; crash-gap reconciliation remains a gate.
		await this.deps.record({
			key,
			kind: "delegation",
			state: "submitted",
			realtimeSessionId: this.#config?.realtimeSessionId,
			text: event.text,
		});
		if (this.active)
			this.deps.emit("thread/realtime/itemAdded", {
				item: {
					type: "handoff_request",
					handoff_id: event.id,
					item_id: event.itemId ?? event.id,
					input_transcript: event.text,
					active_transcript: activeTranscript,
				},
			});
		this.#pendingDelegations++;
		void this.deps
			.delegate(key, event.text)
			.then(async text => {
				await this.deps.record({ key, kind: "delegationResult", text });
				if (this.#config?.clientManagedHandoffs || !this.active) return;
				if (this.#config?.version === "v3")
					for (const chunk of contextChunks(text))
						this.#send({
							type: "delegation.context.append",
							delegation_item_id: event.id,
							channel: "speakable",
							content: [{ type: "input_text", text: chunk }],
						});
				else this.#send({ type: "conversation.handoff.append", handoff_id: event.id, output_text: text });
			})
			.catch(() => this.#fail("The backing agent could not complete the voice request"))
			.finally(() => {
				this.#pendingDelegations--;
			});
	}
}
