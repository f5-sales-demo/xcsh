import { isVoiceFrame, type VoiceFrame, type VoiceRequest, type VoiceState } from "./contract";

export interface VoiceTransport {
	send(message: VoiceRequest): void;
	onMessage(listener: (message: unknown) => void): () => void;
}
export interface BrowserVoiceSnapshot {
	available: boolean;
	active: boolean;
	state: VoiceState;
	chatId?: string;
	ownerRevision?: number;
	message?: string;
	caption?: string;
	closureConfirmed?: boolean;
	companionUrl?: string;
}
/** Media goes directly to the provider. Delegation is handled only by xcsh's sideband. */
export class BrowserVoiceClient {
	#clientId = crypto.randomUUID();
	#snapshot: BrowserVoiceSnapshot = { available: false, active: false, state: "Listening" };
	#listeners = new Set<(snapshot: BrowserVoiceSnapshot) => void>();
	#unsubscribe: () => void;
	#peer?: RTCPeerConnection;
	#microphone?: MediaStream;
	#channel?: RTCDataChannel;
	#audio?: HTMLAudioElement;
	#context?: AudioContext;
	#animation?: number;
	#generation = 0;
	#paused = false;
	#muted = false;
	#interrupted = false;
	#quietSince?: number;
	#announcement?: { requestId: string; revision: number };
	#captionCompleted = false;
	#playedOutput = false;
	#playbackQuietSince?: number;
	#working = false;
	#needsInput = false;
	#closeTimer?: ReturnType<typeof setTimeout>;
	#connectTimer?: ReturnType<typeof setTimeout>;
	constructor(
		private readonly transport: VoiceTransport,
		private readonly devicesApi: Pick<MediaDevices, "getUserMedia" | "enumerateDevices"> = {
			getUserMedia: constraints => navigator.mediaDevices.getUserMedia(constraints),
			enumerateDevices: () => navigator.mediaDevices.enumerateDevices(),
		},
	) {
		this.#unsubscribe = transport.onMessage(message => {
			if (isVoiceFrame(message)) this.#event(message);
		});
		transport.send({
			type: "voice_request",
			clientId: this.#clientId,
			requestId: crypto.randomUUID(),
			action: "capabilities",
		});
	}
	get snapshot(): BrowserVoiceSnapshot {
		return this.#snapshot;
	}
	subscribe(listener: (snapshot: BrowserVoiceSnapshot) => void): () => void {
		this.#listeners.add(listener);
		listener(this.#snapshot);
		return () => this.#listeners.delete(listener);
	}
	#update(update: Partial<BrowserVoiceSnapshot>): void {
		this.#snapshot = { ...this.#snapshot, ...update };
		for (const listener of this.#listeners) listener(this.#snapshot);
	}
	#send(action: VoiceRequest["action"], extra: Partial<VoiceRequest> = {}): void {
		this.transport.send({
			type: "voice_request",
			requestId: crypto.randomUUID(),
			clientId: this.#clientId,
			action,
			chatId: this.#snapshot.chatId,
			...extra,
		});
	}
	async start(takeover = false): Promise<void> {
		if (this.#snapshot.active || !this.#snapshot.available || !this.#snapshot.chatId) return;
		const generation = ++this.#generation;
		this.#paused = this.#muted = this.#interrupted = false;
		this.#update({ active: true, state: "Connecting", message: undefined, closureConfirmed: undefined });
		this.#connectTimer = setTimeout(() => {
			if (generation === this.#generation)
				this.#fail("Voice connection timed out. Check the call before starting again.");
		}, 30_000);
		try {
			// Called only from the user's Start/Take over activation.
			const microphone = await this.devicesApi.getUserMedia({ audio: true });
			if (generation !== this.#generation) {
				microphone.getTracks().forEach(track => {
					track.stop();
				});
				return;
			}
			this.#microphone = microphone;
			const peer = new RTCPeerConnection();
			this.#peer = peer;
			const audio = new Audio();
			audio.autoplay = true;
			this.#audio = audio;
			peer.addEventListener("track", event => {
				if (generation !== this.#generation) return;
				const stream = new MediaStream([event.track]);
				audio.srcObject = stream;
				void audio.play().catch(() => this.#update({ message: "Select Resume to enable speaker output." }));
				this.#measurePlayback(stream, generation);
			});
			peer.addEventListener("connectionstatechange", () => {
				if (generation === this.#generation && ["failed", "disconnected"].includes(peer.connectionState))
					this.#fail("Voice disconnected. Activate again after checking the pending call.");
			});
			for (const track of microphone.getAudioTracks()) peer.addTrack(track, microphone);
			const channel = peer.createDataChannel("oai-events");
			this.#channel = channel;
			channel.addEventListener("message", event => {
				if (generation !== this.#generation || typeof event.data !== "string" || event.data.length > 1_048_576)
					return;
				try {
					const value = JSON.parse(event.data);
					if (value.type === "session.started") {
						clearTimeout(this.#connectTimer);
						this.#update({ state: "Listening" });
					} else if (value.type === "session.closed") {
						const seconds = value.usage?.seconds;
						const confirmed =
							seconds === undefined || (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0);
						this.#update({ closureConfirmed: confirmed });
						this.#send("stop");
						this.#cleanup();
					} else if (
						value.type === "turn.done" &&
						value.turn?.role === "user" &&
						this.#paused &&
						/^resume[.!]?$/i.test(value.turn.transcript?.trim() ?? "")
					)
						this.resume(false);
				} catch {
					this.#fail("Voice sent a malformed event. The call has been stopped.");
				}
			});
			await peer.setLocalDescription(await peer.createOffer());
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => {
					peer.removeEventListener("icegatheringstatechange", ready);
					reject(new Error("ICE timeout"));
				}, 10_000);
				const ready = () => {
					if (peer.iceGatheringState === "complete") {
						clearTimeout(timer);
						peer.removeEventListener("icegatheringstatechange", ready);
						resolve();
					}
				};
				peer.addEventListener("icegatheringstatechange", ready);
				ready();
			});
			if (generation !== this.#generation) return;
			const sdp = peer.localDescription?.sdp;
			if (!sdp) throw new Error("Missing SDP");
			this.#send("start", { sdp, ...(takeover ? { takeoverRevision: this.#snapshot.ownerRevision } : {}) });
		} catch {
			if (generation === this.#generation)
				this.#fail("Microphone or connection unavailable. Choose Start deliberately to try again.");
		}
	}
	#event(frame: VoiceFrame): void {
		if (frame.clientId !== undefined && frame.clientId !== this.#clientId) return;
		if (frame.method === "xcsh/voice/capabilities") {
			this.#update({
				available: frame.params.model === "gpt-live-1" && frame.params.transport === "webrtc",
				chatId: frame.chatId,
				ownerRevision: (frame.params.owner as { revision?: number } | undefined)?.revision,
			});
			return;
		}
		if (frame.chatId !== this.#snapshot.chatId) return;
		if (
			frame.method === "xcsh/voice/interaction" &&
			typeof frame.params.requestId === "string" &&
			Number.isSafeInteger(frame.params.revision)
		) {
			this.#announcement = { requestId: frame.params.requestId, revision: Number(frame.params.revision) };
			this.#captionCompleted = this.#playedOutput = false;
			this.#playbackQuietSince = undefined;
		}
		if (frame.method === "thread/realtime/transcript/done" && frame.params.role === "assistant")
			this.#captionCompleted = true;

		if (frame.method === "xcsh/voice/control") {
			if (frame.params.action === "mute") this.mute(true, false);
			else if (frame.params.action === "unmute") this.mute(false, false);
			else if (frame.params.action === "pause") this.pause(false);
			else if (frame.params.action === "resume") this.resume(false);
			else if (frame.params.action === "interrupt") this.interrupt(false);
			return;
		}
		if (frame.method === "xcsh/voice/owner" && typeof frame.params.revision === "number")
			this.#update({ ownerRevision: frame.params.revision });

		if (frame.method === "xcsh/voice/companion" && typeof frame.params.url === "string") {
			const url = new URL(frame.params.url);
			if (
				url.protocol === "https:" &&
				!url.username &&
				!url.password &&
				/^[A-Za-z0-9_-]{43}$/.test(url.hash.slice(1))
			)
				this.#update({ companionUrl: url.href });
			return;
		}
		if (frame.method === "thread/realtime/sdp" && this.#peer && typeof frame.params.sdp === "string") {
			const generation = this.#generation;
			void this.#peer.setRemoteDescription({ type: "answer", sdp: frame.params.sdp }).catch(() => {
				if (generation === this.#generation) this.#fail("Voice media negotiation failed.");
			});
		} else if (frame.method === "thread/realtime/closed") this.#cleanup();
		else if (frame.method === "xcsh/voice/closure")
			this.#update({ closureConfirmed: frame.params.confirmed === true });
		else if (frame.method === "xcsh/voice/error" || frame.method === "thread/realtime/error") {
			this.#update({ ownerRevision: (frame.params.owner as { revision?: number } | undefined)?.revision });
			this.#fail("Voice could not continue. Check the current audio owner before trying again.");
		} else if (frame.method === "thread/realtime/transcript/delta" && typeof frame.params.delta === "string")
			this.#update({ caption: frame.params.delta });
		else if (frame.method === "thread/status/changed") {
			const status = frame.params.status as { type?: string; activeFlags?: string[] } | undefined;
			this.#working = status?.type === "active";
			this.#needsInput = status?.activeFlags?.includes("waitingOnUserInput") === true;
		}
	}
	#measurePlayback(stream: MediaStream, generation: number): void {
		const context = new AudioContext();
		this.#context = context;
		const analyser = context.createAnalyser();
		analyser.fftSize = 512;
		context.createMediaStreamSource(stream).connect(analyser);
		const samples = new Float32Array(analyser.fftSize);
		const tick = () => {
			if (generation !== this.#generation) return;
			analyser.getFloatTimeDomainData(samples);
			const audible = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length) > 0.003;
			if (this.#interrupted) {
				if (audible) this.#quietSince = undefined;
				else {
					this.#quietSince ??= performance.now();
					if (performance.now() - this.#quietSince >= 250) {
						this.#interrupted = false;
						if (this.#audio) this.#audio.muted = this.#paused;
					}
				}
			}
			const speaking = audible && !this.#audio?.muted && !this.#audio?.paused && context.state === "running";
			if (speaking) {
				this.#playedOutput = true;
				this.#playbackQuietSince = undefined;
			} else if (
				this.#playedOutput &&
				this.#captionCompleted &&
				this.#announcement &&
				!this.#paused &&
				!this.#interrupted
			) {
				this.#playbackQuietSince ??= performance.now();
				if (performance.now() - this.#playbackQuietSince >= 500) {
					this.#send("playback", {
						announcementId: this.#announcement.requestId,
						announcementRevision: this.#announcement.revision,
					});
					this.#announcement = undefined;
					this.#playedOutput = false;
				}
			}
			if (!["Connecting", "Closing", "Error"].includes(this.#snapshot.state)) {
				const state: VoiceState = this.#muted
					? "Muted"
					: speaking
						? "Speaking"
						: this.#needsInput
							? "Needs input"
							: this.#working
								? "Working"
								: "Listening";
				if (state !== this.#snapshot.state) this.#update({ state });
			}
			this.#animation = requestAnimationFrame(tick);
		};
		tick();
	}
	mute(muted: boolean, notify = true): void {
		if (notify) this.#send(muted ? "mute" : "unmute");
		this.#muted = muted;
		this.#microphone?.getAudioTracks().forEach(track => {
			track.enabled = !muted;
		});
		this.#update({ state: muted ? "Muted" : "Listening" });
	}
	pause(notify = true): void {
		if (notify) this.#send("pause");
		this.#captionCompleted = this.#playedOutput = false;
		this.#paused = true;
		if (this.#audio) this.#audio.muted = true;
		this.#update({ state: "Listening", message: "Speech paused. Say resume or select Resume." });
	}
	resume(notify = true): void {
		if (notify) this.#send("resume");
		this.#paused = false;
		if (this.#audio) {
			this.#audio.muted = this.#interrupted;
			void this.#audio.play().catch(() => {});
		}
		void this.#context?.resume();
		this.#update({ message: undefined });
	}
	interrupt(notify = true): void {
		if (notify) this.#send("interrupt");
		this.#captionCompleted = this.#playedOutput = false;
		this.#interrupted = true;
		this.#quietSince = undefined;
		if (this.#audio) this.#audio.muted = true;
		this.#update({ state: "Listening" });
	}
	companion(): void {
		this.#send("companion");
	}
	devices(): Promise<MediaDeviceInfo[]> {
		return this.devicesApi.enumerateDevices();
	}
	stop(): void {
		if (!this.#snapshot.active) return;
		this.#update({ state: "Closing" });
		this.#microphone?.getTracks().forEach(track => {
			track.enabled = false;
		});
		this.#send("stop");
		clearTimeout(this.#closeTimer);
		this.#closeTimer = setTimeout(() => {
			this.#update({ closureConfirmed: false, message: "Provider closure is unconfirmed." });
			this.#cleanup();
		}, 20_000);
	}
	#fail(message: string): void {
		if (this.#snapshot.active && this.#snapshot.chatId) this.#send("stop");
		this.#cleanup();
		this.#update({ state: "Error", message });
	}
	#cleanup(): void {
		this.#generation++;
		clearTimeout(this.#closeTimer);
		clearTimeout(this.#connectTimer);
		if (this.#animation !== undefined) cancelAnimationFrame(this.#animation);
		this.#microphone?.getTracks().forEach(track => {
			track.stop();
		});
		this.#microphone = undefined;
		this.#channel?.close();
		this.#channel = undefined;
		this.#peer?.close();
		this.#peer = undefined;
		if (this.#audio) this.#audio.srcObject = null;
		this.#audio = undefined;
		void this.#context?.close();
		this.#context = undefined;
		this.#update({ active: false });
	}
	dispose(): void {
		this.stop();
		this.#cleanup();
		this.#unsubscribe();
		this.#listeners.clear();
	}
}
