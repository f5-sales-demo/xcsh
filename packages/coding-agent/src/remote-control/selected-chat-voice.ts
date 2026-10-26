import { randomUUID } from "node:crypto";
import { NativeVoiceAudio, nativeVoiceDevices } from "@f5-sales-demo/pi-natives";
import type { VoiceFrame, VoiceRequest } from "../../../chat-ui/src/voice/contract";
import { BUILD_INFO } from "../internal-urls/build-info.generated";
import { RemoteSession, type SessionTarget } from "./session";
import { voiceCoordinatorFor } from "./voice-coordinator";
import {
	type AudioDeviceCatalog,
	type AudioDevicePreferences,
	validateAudioPreferences,
} from "./voice-device-selection";
import { pendingVoiceCalls } from "./voice-persisted-calls";

export interface SelectedVoiceSession {
	call(id: string, method: string, params: Record<string, unknown>): Promise<unknown>;
	subscribe(listener: (event: { method: string; params: Record<string, unknown> }) => void): () => void;
	close(): Promise<void>;
}
/** Both stdio and WebSocket use the selected AgentSession and retain parent host tools. */
export class SelectedChatVoice {
	#remote?: SelectedVoiceSession;
	#boundChatId?: string;
	#unsubscribe?: () => void;
	#disposed = false;
	#clients = new Map<string, SelectedChatVoice>();
	#native?: NativeVoiceAudio;
	#nativeStarting = false;
	#nativePreferences: Readonly<AudioDevicePreferences> = {};
	#nativeGeneration = 0;
	#nativeRequest?: string;
	#nativeAdmitted = false;
	#nativeAnswerFailed = false;
	#nativeState?: string;
	#nativeBackendState = "Listening";
	#nativePendingInput = false;
	#nativeAnswer?: Promise<void>;
	#nativePoll?: ReturnType<typeof setInterval>;
	#nativeDesiredMute = false;
	#nativePaused = false;
	#nativeInterrupted = false;
	#nativeAnnouncement?: { id: string; revision: number };
	#nativeCaptionCompleted = false;
	#nativePlayed = false;
	#nativeQuietSince?: number;
	#unsubscribeDispose?: () => void;
	#unsubscribeTransitions?: () => void;
	#companion?: { url: string; close(): Promise<void>; control(action: string): void };
	#clientId = `client:${randomUUID()}`;
	constructor(
		private readonly target: SessionTarget,
		private readonly sink: (event: VoiceFrame) => void,
		private readonly createSession: () => SelectedVoiceSession = () => new RemoteSession(target),
		clientId?: string,
	) {
		if (clientId) this.#clientId = clientId;
		this.#unsubscribeDispose = target.addBeforeDisposeHook?.(() => this.close());
		this.#unsubscribeTransitions = target.subscribeSessionTransitions?.(async phase => {
			if (phase === "before") {
				await this.#companion?.close();
				this.#companion = undefined;
			}
		});
	}
	#emit(event: VoiceFrame): void {
		if (event.method === "xcsh/voice/interactionState") this.#nativePendingInput = event.params.waiting === true;
		if (event.method === "thread/status/changed") {
			const status = event.params.status as { type?: string; activeFlags?: string[] } | undefined;
			this.#nativeBackendState = status?.activeFlags?.includes("waitingOnUserInput")
				? "Needs input"
				: status?.type === "active"
					? "Working"
					: "Listening";
		}
		if (event.method === "thread/realtime/sdp" && this.#native && typeof event.params.sdp === "string")
			this.#nativeAnswer = this.#native.applyAnswer(event.params.sdp).catch(() => {
				this.#nativeAnswerFailed = true;
				this.#stopNative();
				this.sink({
					type: "voice_event",
					chatId: event.chatId,
					method: "xcsh/voice/error",
					params: { message: "Native audio negotiation failed" },
				});
				void this.handle({ type: "voice_request", action: "stop", chatId: event.chatId, requestId: randomUUID() });
			});
		if (event.method === "xcsh/voice/receipt" && event.requestId === this.#nativeRequest)
			this.#nativeAdmitted = event.params.accepted === true;
		if (
			event.method === "xcsh/voice/interaction" &&
			typeof event.params.requestId === "string" &&
			Number.isSafeInteger(event.params.revision)
		) {
			this.#nativeAnnouncement = { id: event.params.requestId, revision: Number(event.params.revision) };
			this.#nativeCaptionCompleted = this.#nativePlayed = false;
			this.#nativeQuietSince = undefined;
		}
		if (event.method === "thread/realtime/transcript/done") {
			if (event.params.role === "assistant") this.#nativeCaptionCompleted = true;
			if (
				event.params.role === "user" &&
				this.#native &&
				typeof event.params.text === "string" &&
				(this.#nativeInterrupted || (this.#nativePaused && /^resume[.!]?$/i.test(event.params.text.trim())))
			) {
				if (/^resume[.!]?$/i.test(event.params.text.trim())) this.#nativePaused = false;
				this.#nativeInterrupted = false;
				this.#native.suppressOutput(this.#nativePaused);
			}
		}
		if (["thread/realtime/error", "thread/realtime/closed", "xcsh/voice/error"].includes(event.method))
			this.#stopNative();
		this.sink(event);
	}
	#stopNative(): void {
		this.#nativeGeneration++;
		clearInterval(this.#nativePoll);
		this.#native?.stop();
		this.#native = undefined;
	}
	async nativeDevices(): Promise<AudioDeviceCatalog> {
		const directory = process.env.XCSH_VOICE_PACKAGE_DIR,
			manifest = process.env.XCSH_VOICE_PACKAGE_SHA256;
		if (this.#disposed || BUILD_INFO.dirty || !directory || !manifest)
			throw new Error("An immutable qualified native voice package is required");
		return nativeVoiceDevices({ packageDir: directory, buildCommit: BUILD_INFO.commit, manifestSha256: manifest });
	}
	selectNativeDevices(catalog: AudioDeviceCatalog, preferences: AudioDevicePreferences): void {
		if (this.#disposed || this.#native || this.#nativeStarting)
			throw new Error("End native voice before selecting devices");
		this.#nativePreferences = validateAudioPreferences(catalog, preferences);
	}
	async startNative(takeover = false): Promise<void> {
		if (this.#disposed || this.#native || this.#nativeStarting) throw new Error("Audio is already active");
		if (!["darwin", "linux"].includes(process.platform) || process.env.SSH_CONNECTION)
			throw new Error("Use an explicitly activated companion on this terminal");
		const directory = process.env.XCSH_VOICE_PACKAGE_DIR,
			manifest = process.env.XCSH_VOICE_PACKAGE_SHA256;
		if (BUILD_INFO.dirty || !directory || !manifest)
			throw new Error("An immutable qualified native voice package is required");
		this.#nativeStarting = true;
		this.#nativeDesiredMute = false;
		this.#nativePendingInput = false;
		this.#nativePaused = this.#nativeInterrupted = false;
		this.#nativeAnnouncement = undefined;
		this.#nativeCaptionCompleted = this.#nativePlayed = false;
		this.#nativeQuietSince = undefined;
		this.#nativeState = undefined;
		try {
			const chatId = this.target.sessionId,
				generation = ++this.#nativeGeneration;
			const revision = voiceCoordinatorFor(this.target, chatId).snapshot?.revision;
			const native = await NativeVoiceAudio.start({
				packageDir: directory,
				buildCommit: BUILD_INFO.commit,
				manifestSha256: manifest,
				...this.#nativePreferences,
			});
			if (generation !== this.#nativeGeneration || this.#disposed || this.target.sessionId !== chatId) {
				native.stop();
				return;
			}
			this.#native = native;
			native.mute(true);
			native.suppressOutput(true);
			this.#nativeRequest = randomUUID();
			this.#nativeAnswerFailed = false;
			this.#nativeAdmitted = false;
			this.#nativeAnswer = undefined;
			try {
				await this.handle({
					type: "voice_request",
					action: "start",
					requestId: this.#nativeRequest,
					chatId,
					sdp: native.offerSdp,
					...(takeover && revision !== undefined ? { takeoverRevision: revision } : {}),
				});
				if (!this.#nativeAdmitted || !this.#nativeAnswer || this.#nativeAnswerFailed)
					throw new Error("Native call admission failed");
				await this.#nativeAnswer;
				if (generation !== this.#nativeGeneration || this.target.sessionId !== chatId) {
					native.stop();
					return;
				}
				for (const action of [
					this.#nativeDesiredMute ? "mute" : undefined,
					this.#nativePaused ? "pause" : undefined,
				])
					if (action) await this.#remote?.call(randomUUID(), "xcsh/voice/control", { threadId: chatId, action });
				if (generation !== this.#nativeGeneration || this.target.sessionId !== chatId) {
					native.stop();
					return;
				}
				native.mute(this.#nativeDesiredMute);
				native.suppressOutput(this.#nativePaused || this.#nativeInterrupted);
				this.#nativePoll = setInterval(() => {
					const error = native.takeError();
					if (error) {
						this.#emit({
							type: "voice_event",
							chatId,
							method: "xcsh/voice/error",
							params: { message: "Native audio stopped" },
						});
						void this.handle({ type: "voice_request", action: "stop", requestId: randomUUID(), chatId });
						return;
					}
					const audio = native.audioState();
					const state =
						audio.applied && audio.microphoneMuted
							? "Muted"
							: audio.applied && !audio.speakerSuppressed && audio.speakerPeak > 100
								? "Speaking"
								: this.#nativePendingInput
									? "Needs input"
									: this.#nativeBackendState;
					if (state !== this.#nativeState) {
						this.#nativeState = state;
						this.sink({ type: "voice_event", chatId, method: "xcsh/voice/audioState", params: { state } });
					}
					if (audio.applied && !audio.speakerSuppressed && audio.speakerPeak > 100) {
						this.#nativePlayed = true;
						this.#nativeQuietSince = undefined;
					} else if (
						this.#nativePlayed &&
						this.#nativeCaptionCompleted &&
						this.#nativeAnnouncement &&
						!this.#nativePaused &&
						!this.#nativeInterrupted
					) {
						this.#nativeQuietSince ??= Date.now();
						if (Date.now() - this.#nativeQuietSince >= 500) {
							void this.handle({
								type: "voice_request",
								action: "playback",
								requestId: randomUUID(),
								chatId,
								announcementId: this.#nativeAnnouncement.id,
								announcementRevision: this.#nativeAnnouncement.revision,
							});
							this.#nativeAnnouncement = undefined;
							this.#nativePlayed = false;
						}
					}
				}, 50);
			} catch {
				this.#stopNative();
				throw new Error("Native voice could not connect");
			}
		} finally {
			this.#nativeStarting = false;
		}
	}
	async handle(request: VoiceRequest): Promise<void> {
		if (request.clientId && request.clientId !== this.#clientId) {
			if (this.#disposed || !/^[A-Za-z0-9:_-]{1,128}$/.test(request.clientId)) return;
			let client = this.#clients.get(request.clientId);
			if (!client) {
				if (request.action !== "capabilities" || this.#clients.size >= 8) return;
				const clientId = request.clientId;
				client = new SelectedChatVoice(
					this.target,
					event => this.sink({ ...event, clientId }),
					this.createSession,
					clientId,
				);
				this.#clients.set(clientId, client);
			}
			await client.handle({ ...request, clientId: undefined });
			return;
		}

		const chatId = this.target.sessionId;
		const reply = (method: string, params: Record<string, unknown>) =>
			this.#emit({ type: "voice_event", chatId, requestId: request.requestId, method, params });
		if (this.#disposed) return;
		if (request.action === "capabilities") {
			const owner = voiceCoordinatorFor(this.target, chatId).snapshot;
			const records = (
				this.target.sessionManager?.getBranch?.() ??
				this.target.sessionManager?.getEntries() ??
				[]
			).flatMap(entry =>
				entry.type === "custom" &&
				entry.customType === "remote-realtime" &&
				entry.data &&
				typeof entry.data === "object"
					? [entry.data as Record<string, unknown>]
					: [],
			);
			const pending = pendingVoiceCalls(records, chatId);
			reply("xcsh/voice/capabilities", {
				model: "gpt-live-1",
				transport: "webrtc",
				clientId: this.#clientId,
				pendingCall: pending.calls.length > 0 || pending.uncertainCreation,
				...(owner ? { owner } : {}),
			});
			return;
		}
		if (request.chatId !== chatId) {
			reply("xcsh/voice/error", { message: "The selected chat changed. Activate voice again." });
			return;
		}
		if (request.action === "stop") this.#stopNative();
		if (["mute", "unmute", "pause", "resume", "interrupt", "devices"].includes(request.action)) {
			if (request.action === "mute") this.#nativeDesiredMute = true;
			if (request.action === "unmute") this.#nativeDesiredMute = false;
			if (request.action === "pause" || request.action === "interrupt") {
				this.#nativeCaptionCompleted = this.#nativePlayed = false;
				if (request.action === "pause") this.#nativePaused = true;
				if (request.action === "interrupt") this.#nativeInterrupted = true;
			}
			if (request.action === "resume") this.#nativePaused = this.#nativeInterrupted = false;
			if (this.#native) {
				this.#native.mute(!this.#nativeAdmitted || this.#nativeDesiredMute);
				this.#native.suppressOutput(!this.#nativeAdmitted || this.#nativePaused || this.#nativeInterrupted);
			}
			await this.#remote?.call(request.requestId, "xcsh/voice/control", {
				threadId: chatId,
				action: request.action,
			});
			this.#companion?.control(request.action);
			reply("xcsh/voice/control", { action: request.action });
			return;
		}
		if (request.action === "playback") {
			await this.#remote?.call(request.requestId, "xcsh/voice/playback", {
				threadId: chatId,
				announcementId: request.announcementId,
				announcementRevision: request.announcementRevision,
			});
			return;
		}
		if (request.action === "companion") {
			try {
				await this.#companion?.close();
				const { startVoiceCompanion } = await import("./voice-companion");
				this.#companion = await startVoiceCompanion(this.target, event => this.#emit(event));
				if (this.#disposed || this.target.sessionId !== chatId) {
					await this.#companion.close();
					return;
				}
				reply("xcsh/voice/companion", { url: this.#companion.url });
			} catch {
				reply("xcsh/voice/error", { message: "Trusted companion audio is unavailable on this host." });
			}
			return;
		}
		if (request.action === "stop" && this.#companion) {
			await this.#companion.close();
			this.#companion = undefined;
		}
		try {
			if (this.#boundChatId && this.#boundChatId !== chatId) {
				await this.#remote?.close();
				this.#unsubscribe?.();
				this.#remote = undefined;
			}
			if (!this.#remote) {
				this.#remote = this.createSession();
				this.#boundChatId = chatId;
				this.#unsubscribe = this.#remote.subscribe(event => {
					if (
						event.method.startsWith("thread/realtime/") ||
						event.method.startsWith("xcsh/voice/") ||
						event.method.startsWith("xcsh/interaction/") ||
						event.method.startsWith("item/") ||
						event.method.startsWith("turn/") ||
						event.method === "thread/status/changed"
					)
						this.#emit({ type: "voice_event", chatId, method: event.method, params: event.params });
				});
			}
			if (request.action === "history") {
				const result = await this.#remote.call(request.requestId, "thread/read", {
					threadId: chatId,
					includeTurns: true,
				});
				reply("xcsh/voice/history", { result });
				return;
			}
			if (request.action === "interaction") {
				const result = (await this.#remote.call(request.requestId, "xcsh/interaction", {
					threadId: chatId,
					command: request.command,
				})) as Record<string, unknown>;
				if (request.command?.type === "interaction_snapshot")
					reply("xcsh/voice/ui", { frame: { type: "interaction_snapshot", ...result } });
				else if (request.command && "responseId" in request.command)
					reply("xcsh/voice/ui", {
						frame: {
							type: "interaction_receipt",
							responseId: request.command.responseId,
							accepted: result.accepted === true,
						},
					});
				return;
			}
			if (request.action === "text") {
				const data = (await this.#remote.call(`${request.requestId}:read`, "thread/read", {
					threadId: chatId,
					includeTurns: true,
				})) as { thread?: { turns?: { id: string; status: string }[] } };
				const active = data.thread?.turns?.findLast(turn => turn.status === "inProgress");
				await this.#remote.call(request.requestId, active ? "turn/steer" : "turn/start", {
					threadId: chatId,
					...(active ? { expectedTurnId: active.id } : {}),
					clientUserMessageId: request.requestId,
					input: [{ type: "text", text: request.text }],
				});
				return;
			}
			if (request.action === "cancel") {
				await this.#remote.call(request.requestId, "turn/interrupt", { threadId: chatId, turnId: request.turnId });
				return;
			}
			await this.#remote.call(request.requestId, `thread/realtime/${request.action}`, {
				threadId: chatId,
				...(request.action === "stop" ? { xcshVoice: { cleanup: request.cleanup === true } } : {}),
				...(request.action === "start"
					? {
							version: "v3",
							model: "gpt-live-1",
							outputModality: "audio",
							includeStartupContext: false,
							transport: { type: "webrtc", sdp: request.sdp },
							xcshVoice: { clientId: this.#clientId, takeoverRevision: request.takeoverRevision },
						}
					: {}),
			});
			reply("xcsh/voice/receipt", { accepted: true });
		} catch {
			const owner = voiceCoordinatorFor(this.target, chatId).snapshot;
			reply("xcsh/voice/error", {
				message: "Voice could not connect. Check the current audio owner and call before trying again.",
				...(owner ? { owner } : {}),
			});
		}
	}
	async disconnectClient(clientId: string): Promise<void> {
		if (this.#disposed) return;
		const client = this.#clients.get(clientId);
		if (!client) return;
		this.#clients.delete(clientId);
		await client.close();
	}
	async close(): Promise<void> {
		this.#disposed = true;
		this.#stopNative();
		await Promise.all([...this.#clients.values()].map(client => client.close()));
		this.#unsubscribeDispose?.();
		this.#unsubscribeTransitions?.();
		await this.#companion?.close();
		await this.#remote?.close();
		this.#unsubscribe?.();
	}
}
