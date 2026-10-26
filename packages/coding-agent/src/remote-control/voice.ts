/** Native WebRTC and existing-call sideband; AgentSession remains the sole executor. */
import { createHash, randomUUID } from "node:crypto";
import { prompt, VERSION } from "@f5-sales-demo/pi-utils";
import { VOICE_POLICY } from "../internal-urls/build-info.generated";
import listeningReminder from "../prompts/system/remote-voice-listening-reminder.md" with { type: "text" };
import tailTemplate from "../prompts/system/remote-voice-tail.md" with { type: "text" };
import type { RealtimeModeInstructions } from "../session/realtime-context";
import type { SubscriptionAuth } from "./enrollment";
import { ProtocolError } from "./session";
import { traceFromEnvironment } from "./trace-runtime";
import { VoiceAudioEvidence } from "./voice-audio-evidence";
import { createVoiceCall, VoiceCallCreationError, voiceCallConfig } from "./voice-call";
import { type OwnedVoiceCallIdentity, reconcileVoiceCall } from "./voice-call-recovery";
import { VoiceCaptionBranding } from "./voice-caption-branding";
import { evaluateVoiceContract, type VoiceCreationEvidence } from "./voice-contract-evidence";
import { voiceDelegation } from "./voice-delegation";
import { type VoiceDiagnosticRuntime, voiceDiagnosticRuntimeFromEnvironment } from "./voice-diagnostics";
import { VoiceFinalization } from "./voice-finalization";
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
import { pendingVoiceCalls } from "./voice-persisted-calls";
import { type VoicePersonaSnapshot, voicePersonaInstructions, voiceRuntimeContext } from "./voice-persona";
import { voicePronunciationInstructions } from "./voice-pronunciation";
import {
	CODEX_LIVE_VERSION,
	contextChunks,
	existingCallConfig,
	inspectVoiceEvent,
	type VoiceEvent,
	type VoiceEventDecode,
	type VoiceEventRejection,
	voiceInstructions,
} from "./voice-protocol";
import {
	VoiceResultFidelity,
	type VoiceResultFidelityObservation,
	voiceResultInstructions,
} from "./voice-result-fidelity";
import { openVoiceSocket, type VoiceHandlers, type VoiceSocket } from "./voice-socket";
import { openDiagnosticVoiceSocket } from "./voice-socket-diagnostic";
import { standaloneVoiceConfig } from "./voice-standalone";
import { isSniffAnnotation, StartupAssistantPolicy } from "./voice-startup-policy";

export interface VoiceDependencies {
	/** Shared by successive calls attached to one backing session. */
	history?: VoiceHistory;
	closureTimeoutMs?: number;
	/** Early committed input may consume controls, never authorize interactions. */
	committedCallerControl?(text: string): Promise<boolean> | boolean;
	completedTranscript?(role: "user" | "assistant", text: string): Promise<boolean> | boolean;
	authenticate(): Promise<SubscriptionAuth>;
	/** Cleanup may outlive the execution epoch; identity is revalidated against the original call. */
	authenticateClosure?(): Promise<SubscriptionAuth>;
	authenticateApiKey?(): Promise<string | undefined>;
	createCall?: typeof createVoiceCall;
	persona?(): VoicePersonaSnapshot | Promise<VoicePersonaSnapshot>;
	/** Compare only with application-owned user history frozen before this attachment. */
	isStartupHistoryRequest?(text: string): boolean;
	modeChanged?(active: boolean, instructions: RealtimeModeInstructions): Promise<void>;
	open?(
		url: string,
		headers: Record<string, string>,
		handlers: VoiceHandlers,
		signal?: AbortSignal,
	): Promise<VoiceSocket>;
	emit(method: string, params: Record<string, unknown>): void;
	records(): Record<string, unknown>[];
	record(record: Record<string, unknown>): Promise<void>;
	title?(text: string): void;
	delegate(id: string, text: string, output?: (update: VoiceOutputUpdate) => void): Promise<string>;
	diagnostics?: VoiceDiagnosticRuntime;
}
const providerErrorTypes = new Set([
	"invalid_request_error",
	"server_error",
	"authentication_error",
	"permission_error",
	"rate_limit_error",
]);
const providerErrorCodes = new Set([
	"invalid_value",
	"invalid_event",
	"unknown_event",
	"unsupported_event",
	"immutable_field_update",
	"invalid_request",
	"invalid_request_error",
	"forbidden",
	"permission_denied",
	"rate_limit_exceeded",
	"server_error",
	"invalid_api_key",
	"session_expired",
]);
const providerErrorParams = new Set([
	"type",
	"content",
	"event_id",
	"client_event_id",
	"delegation_id",
	"session",
	"session.instructions",
	"session.delegation.type",
]);
const voiceProtocolCommands = [
	"session.instructions.append",
	"session.thinking.append",
	"session.commentary.append",
	"session.context.append",
	"delegation.context.append",
	"session.update",
	"session.start",
	"session.close",
	"input_audio.append",
	"session.input_audio.mute",
	"session.input_audio.unmute",
	"response.create",
	"response.item.create",
];
function connectionFailure(
	error: unknown,
): "http" | "upgradeRejected" | "closed" | "timeout" | "transport" | "provider" {
	const message = error instanceof Error ? error.message : "";
	if (message === "Live provider rejected a command") return "provider";
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
	const field =
		error instanceof Error
			? /^Native realtime call failed \(HTTP 400; rejected field (session\.(?:model|instructions|audio\.output\.voice|delegation|initial_items))\)$/.exec(
					error.message,
				)?.[1]
			: undefined;
	return `Native realtime connection failed${status ? ` (HTTP ${status}${field ? `; rejected field ${field}` : ""})` : ""}`;
}
export class NativeVoice {
	#ownedCreation?: VoiceCreationEvidence;
	#knownCall?: OwnedVoiceCallIdentity;
	#recovery?: Promise<void>;
	#creationAttemptId?: string;
	#persisted: ReturnType<typeof pendingVoiceCalls>;
	#persistedRecovery?: Promise<void>;
	#creationDisposition: "not-attempted" | "in-flight" | "accepted" | "rejected" | "uncertain" = "not-attempted";
	get canReleaseAudioOwnership(): boolean {
		return (
			this.#closureConfirmed ||
			this.#creationDisposition === "not-attempted" ||
			this.#creationDisposition === "rejected"
		);
	}
	#answeredInteraction?: string;
	get ownedCall(): boolean {
		return !!this.#ownedCreation || !!this.#knownCall || this.#persisted.calls.length > 0;
	}
	#finalization = new VoiceFinalization();
	#closureConfirmed = false;
	get closureConfirmed(): boolean {
		return this.#closureConfirmed;
	}
	#startupPolicy = new StartupAssistantPolicy({ callerFirst: true });
	#acknowledgmentControlPending = false;
	#callerTurnOpen = false;
	#prematureSpeechReported = false;
	#resultFidelity = new VoiceResultFidelity();
	#startupViolation = false;
	#captionBranding = new VoiceCaptionBranding();
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
	#uncertainDelegations = new Set<string>();
	#eventTypes = new Map<string, number>();
	#eventDispositions = new Map<VoiceEventDecode["disposition"], number>();
	#eventRejections = new Map<VoiceEventRejection | "invalidJson" | "droppedFrame", number>();
	#firstEventRecorded = false;
	#diagnosticsTail: Promise<void> = Promise.resolve();
	#startedAt = 0;
	#pendingDelegations = 0;
	#awaitingSession = false;
	#readinessLost = false;
	#policyDelivery?: { eventId: string; policySha256: string; transport: string };
	#sessionReady?: { resolve: () => void; reject: (error: Error) => void };
	#contextRefreshTail = Promise.resolve();
	#workStatusTimer?: ReturnType<typeof setInterval>;
	#runtimeContextHash?: string;
	#audioEvidence = new VoiceAudioEvidence();
	#startupAudioEvidence = new VoiceAudioEvidence();
	#persona: VoicePersonaSnapshot = { tools: [], history: "" };
	#handoffsRetired = false;
	#hasCallerInput = false;
	#diagnostics?: VoiceDiagnosticRuntime;
	constructor(private readonly deps: VoiceDependencies) {
		this.#persisted = pendingVoiceCalls(deps.records());
		if (this.#persisted.uncertainCreation || this.#persisted.calls.length) this.#creationDisposition = "uncertain";
		this.#diagnostics = deps.diagnostics ?? voiceDiagnosticRuntimeFromEnvironment(record => deps.record(record));
	}
	#diagnosticQueues(): void {
		this.#diagnostics?.queues({
			inboundBytes: this.#pendingBytes + this.#openingBytes,
			inboundLimit: 2_097_152,
			outboundBytes: this.#outboundBytes + (this.#socket?.bufferedAmount ?? 0),
			outboundLimit: 1_048_576,
		});
	}
	get active(): boolean {
		return this.#state === "opening" || this.#state === "open" || this.#state === "reconnecting";
	}
	async start(params: Record<string, unknown>): Promise<void> {
		if (this.#state !== "idle") throw new ProtocolError(-32000, "Voice requires a new attachment after stopping");
		if (this.#persisted.uncertainCreation || this.#persisted.calls.length)
			throw new ProtocolError(
				-32000,
				"Previous voice closure is unconfirmed; explicitly end voice before starting another call",
			);
		this.#state = "opening";
		this.#startedAt = Date.now();
		this.#diagnostics?.transition("starting");
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
			this.#runtimeContextHash = createHash("sha256").update(voiceRuntimeContext(this.#persona)).digest("hex");
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
			if (typeof record.key === "string" && record.kind === "delegationResult") prepared.delete(record.key);
		// A prepared record may already have reached the backend when the submitted
		// write failed. Treat all persisted identities as reserved, never replay them.
		this.#uncertainDelegations = prepared;
		this.#seen = new Set(records.filter(record => typeof record.key === "string").map(record => String(record.key)));
		let stage = "authentication";
		const startedAt = Date.now();
		let stageStartedAt = startedAt;
		let sidebandElapsedMs = 0;
		try {
			const persona = voicePersonaInstructions(params, this.#persona);
			const diagnostics = persona.diagnostics;
			if (Buffer.byteLength(persona.instructions) > 8192)
				throw new Error("Compiled voice policy exceeds instruction budget");
			await this.deps.record({
				kind: "voicePolicyDiagnostic",
				policyVersion: VOICE_POLICY.version,
				policySha256: VOICE_POLICY.sha256,
				renderedInstructionsSha256: createHash("sha256").update(persona.instructions).digest("hex"),
				outcome: "prepared",
				transport: standalone ? "api-websocket" : "subscription-sideband",
				creationOwnership: standalone || callConfig ? "xcsh" : "phone",
				startupPolicyConsumptionProven: false,
				spokenBehaviorVerified: false,
			});
			await this.deps.record({ kind: "voicePersonaDiagnostic", ...diagnostics });
			if (this.#state !== "opening") throw new Error("Voice stopped during persona diagnostics");
			const apiKey = standalone ? await this.deps.authenticateApiKey?.() : undefined;
			if (standalone && !apiKey) throw new ProtocolError(-32602, "Realtime conversation requires API key auth");
			const auth = standalone ? undefined : await this.deps.authenticate();
			if (this.#state !== "opening") throw new Error("Voice stopped during authentication");
			await this.#recoverPersisted();
			if (this.#state !== "opening") throw new Error("Voice stopped during persisted call reconciliation");
			await this.deps.record({
				kind: "voiceDiagnostic",
				stage,
				outcome: "succeeded",
				elapsedMs: Date.now() - stageStartedAt,
			});
			this.#diagnostics?.stage(stage, Date.now() - stageStartedAt);
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
				if (this.#state !== "opening" || this.#abort.signal.aborted)
					throw new Error("Voice stopped before call creation");
				this.#creationAttemptId = randomUUID();
				await this.deps.record({
					kind: "voiceCallCreation",
					creationAttemptId: this.#creationAttemptId,
					state: "prepared",
				});
				if (this.#state !== "opening" || this.#abort.signal.aborted) {
					await this.deps.record({
						kind: "voiceCallCreation",
						creationAttemptId: this.#creationAttemptId,
						state: "rejected",
					});
					throw new Error("Voice stopped before persisted creation");
				}
				this.#creationDisposition = "in-flight";
				let call: Awaited<ReturnType<typeof createVoiceCall>>;
				try {
					call = await (this.deps.createCall ?? createVoiceCall)(
						callConfig,
						auth!,
						headers,
						undefined,
						this.#abort.signal,
					);
				} catch (error) {
					this.#creationDisposition = error instanceof VoiceCallCreationError ? error.outcome : "uncertain";
					if (this.#creationDisposition === "rejected")
						await this.deps.record({
							kind: "voiceCallCreation",
							creationAttemptId: this.#creationAttemptId,
							state: "rejected",
						});
					if (error instanceof VoiceCallCreationError && error.callId) {
						this.#knownCall = { callId: error.callId, accountId: auth!.accountId, realtimeSessionId: sessionId };
						this.deps.emit("xcsh/voice/call", { providerCallId: error.callId });
						await this.#recordCallIdentity("uncertain");
					}
					throw error;
				}
				this.#creationDisposition = "accepted";
				this.#knownCall = { callId: call.callId, accountId: auth!.accountId, realtimeSessionId: sessionId };
				await this.#recordCallIdentity("accepted");
				this.#ownedCreation = {
					requestedModel: callConfig.session.model,
					route: "chatgpt-subscription",
					status: 201,
					returnedCallId: call.callId,
					attachedCallId: call.callId,
					fallbackApplied: false,
					configurationOverridden: false,
					routeTraced: true,
				};
				await this.deps.record({
					kind: "voiceContractEvidence",
					...evaluateVoiceContract({ creation: this.#ownedCreation }),
				});
				this.deps.emit("xcsh/voice/call", { providerCallId: call.callId });
				if (this.#state !== "opening") throw new Error("Voice stopped during call creation");
				await this.deps.record({
					kind: "voiceDiagnostic",
					stage,
					outcome: "succeeded",
					elapsedMs: Date.now() - stageStartedAt,
				});
				this.#diagnostics?.stage(stage, Date.now() - stageStartedAt);
				config = existingCallConfig({
					version: CODEX_LIVE_VERSION,
					realtimeSessionId: sessionId,
					outputModality: "audio",
					includeStartupContext: false,
					clientManagedHandoffs: params.clientManagedHandoffs,
					transport: { type: "existingCall", callId: call.callId },
				});
				this.#config = config;
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
				this.deps.emit("thread/realtime/sdp", { sdp: call.sdp });
				await this.deps.record({
					kind: "voiceDiagnostic",
					stage,
					outcome: "succeeded",
					elapsedMs: Date.now() - stageStartedAt,
				});
				this.#diagnostics?.stage(stage, Date.now() - stageStartedAt);
			}
			this.#config = config;
			stage = "sideband-attach";
			stageStartedAt = Date.now();
			this.#awaitingSession = true;
			this.#readinessLost = false;
			const ready = new Promise<void>((resolve, reject) => {
				this.#sessionReady = { resolve, reject };
			});
			// A connection failure can close the attachment before Promise.race
			// starts awaiting this deferred. Keep that rejection handled while
			// retaining the original promise for the readiness gate below.
			void ready.catch(() => {});
			const socket = await this.#connect(headers);
			if (this.#state !== "opening") {
				socket.close();
				throw new Error("Voice stopped while connecting");
			}
			this.#socket = socket;
			this.#state = "open";
			this.#connectedAt = Date.now();
			sidebandElapsedMs = Date.now() - stageStartedAt;
			if (standalone && this.#config?.kind === "websocket")
				socket.send(JSON.stringify({ type: "session.update", session: this.#config.session }));
			let readinessTimer: ReturnType<typeof setTimeout> | undefined;
			await Promise.race([
				ready,
				new Promise<never>((_resolve, reject) => {
					readinessTimer = setTimeout(() => reject(new Error("Live session readiness timed out")), 120_000);
					readinessTimer.unref?.();
				}),
			]).finally(() => clearTimeout(readinessTimer));
			if (!standalone && !callConfig) {
				// Admission and readiness are distinct. Persist the attempted call
				// before bootstrap so a rejected policy still has a durable terminal outcome.
				this.#history ??=
					this.deps.history ??
					new VoiceHistory(
						sessionId,
						record => this.deps.record(record),
						(method, value) => this.deps.emit(method, value),
					);
				this.#chain = this.#history.start(sessionId);
				await this.#chain;
				// The creator owns existing-call instructions. Re-appending the full policy
				// mutates the call and can exceed the subscription context token limit.
			}
			if (this.#readinessLost) throw new Error("Live session ended before readiness");
			this.#awaitingSession = false;
			this.#sessionReady = undefined;
			if (!this.active) throw new Error("Voice stopped during session initialization");
			this.#disableAcknowledgmentFiller();
			// Protocol support follows original authentication, not the attachment kind:
			// owned subscription WebRTC calls also become existing-call sidebands.
			// Subscription instructions belong exclusively to call creation.
			if (standalone) {
				const content = prompt.render(listeningReminder).trim();
				const eventId = randomUUID();
				this.#policyDelivery = {
					eventId,
					policySha256: createHash("sha256").update(content).digest("hex"),
					transport: "api-websocket",
				};
				await this.#recordPolicyDelivery("sent", "event_id");
				this.#send({ type: "session.instructions.append", event_id: eventId, delegation_id: null, content });
			}
			if (!this.#started) {
				this.#started = true;
				this.#history ??=
					this.deps.history ??
					new VoiceHistory(
						sessionId,
						record => this.deps.record(record),
						(method, params) => this.deps.emit(method, params),
					);
				if (!callConfig && !this.#history.engaged) {
					this.#chain = this.#history.start(sessionId);
					await this.#chain;
				}
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
			this.#diagnostics?.stage(stage, sidebandElapsedMs);
			if (!this.active) throw new Error("Voice stopped during connection diagnostics");
			this.#ready = true;
			this.#workStatusTimer = setInterval(() => {
				if (this.#pendingDelegations > 0) void this.inspectWorkStatus().catch(() => {});
			}, 30000);
			this.#workStatusTimer.unref?.();
			this.#diagnostics?.transition("connected");
			const openingInputs = this.#openingInputs;
			this.#openingInputs = [];
			this.#openingBytes = 0;
			for (const data of openingInputs) this.#receive(data);
		} catch (error) {
			this.#diagnostics?.stage(stage, Date.now() - stageStartedAt);
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
	/** A stop already owns the terminal notification, even while persistence drains. */
	get closing(): Promise<void> | undefined {
		return this.#closing;
	}
	stop(reason = "requested"): Promise<void> {
		const closing = this.#stopCore(reason);
		if (this.#persisted.uncertainCreation || this.#persisted.calls.length) {
			const recovery = closing.then(() => this.#recoverPersisted());
			this.#closing = recovery.catch(() => {});
			return this.#closing;
		}
		if (!this.#knownCall || this.#closureConfirmed) return closing;
		if (this.#recovery) return this.#recovery;
		const identity = this.#knownCall;
		this.#recovery = closing
			.then(async () => {
				if (this.#closureConfirmed) return;
				const receipt = await reconcileVoiceCall(
					identity,
					{
						authenticate: () => (this.deps.authenticateClosure ?? this.deps.authenticate)(),
						open: this.deps.open,
					},
					this.deps.closureTimeoutMs,
				);
				this.#closureConfirmed = receipt.confirmed;
				await this.deps
					.record({
						kind: "voiceProviderClosure",
						providerCallId: identity.callId,
						reconciliation: true,
						...receipt,
					})
					.catch(() => {
						this.deps.emit("thread/realtime/error", { message: "Could not persist call reconciliation" });
					});
				this.deps.emit("xcsh/voice/closure", { ...receipt, reconciliation: true });
			})
			.finally(() => {
				this.#recovery = undefined;
			});
		this.#closing = this.#recovery;
		return this.#recovery;
	}
	#recoverPersisted(): Promise<void> {
		if (this.#persistedRecovery) return this.#persistedRecovery;
		if (!this.#persisted.uncertainCreation && !this.#persisted.calls.length) return Promise.resolve();
		const recovery = Promise.resolve()
			.then(async () => {
				if (this.#persisted.uncertainCreation)
					throw new ProtocolError(
						-32000,
						"Previous call creation has no confirmed provider identity; another call cannot start",
					);
				for (const call of [...this.#persisted.calls]) {
					const receipt = await reconcileVoiceCall(
						{
							callId: call.providerCallId,
							realtimeSessionId: call.realtimeSessionId,
							accountId: "",
							accountIdSha256: call.accountIdSha256,
						},
						{
							authenticate: () => (this.deps.authenticateClosure ?? this.deps.authenticate)(),
							open: this.deps.open,
						},
						this.deps.closureTimeoutMs,
					);
					await this.deps.record({
						kind: "voiceProviderClosure",
						providerCallId: call.providerCallId,
						reconciliation: true,
						persisted: true,
						...receipt,
					});
					this.deps.emit("xcsh/voice/recoveryReceipt", {
						...receipt,
						providerCallId: call.providerCallId,
						persisted: true,
					});
					if (!receipt.confirmed)
						throw new ProtocolError(
							-32000,
							"Could not confirm previous call closure with the selected subscription",
						);
					this.#persisted.calls = this.#persisted.calls.filter(value => value !== call);
				}
				this.#creationDisposition = "not-attempted";
				if (!this.active)
					this.deps.emit("xcsh/voice/closure", { confirmed: true, reconciliation: true, persisted: true });
			})
			.finally(() => {
				this.#persistedRecovery = undefined;
			});
		this.#persistedRecovery = recovery;
		return recovery;
	}
	async #recordCallIdentity(disposition: "accepted" | "uncertain"): Promise<void> {
		const identity = this.#knownCall!;
		await this.deps.record({
			kind: "voiceCallIdentity",
			creationAttemptId: this.#creationAttemptId,
			providerCallId: identity.callId,
			realtimeSessionId: identity.realtimeSessionId,
			accountIdSha256: "sha256:" + createHash("sha256").update(identity.accountId).digest("hex"),
			disposition,
		});
		if (this.#state === "closed" && !this.#closureConfirmed) void this.stop("requested");
	}
	#stopCore(reason: string): Promise<void> {
		if (this.#state === "closed" || this.#state === "idle") return this.#closing ?? Promise.resolve();
		const captionTail = this.#captionBranding.flush();
		if (captionTail) {
			this.#chain = this.#chain.then(async () => {
				await this.#history?.transcript("assistant", captionTail, false);
				this.deps.emit("thread/realtime/transcript/delta", { role: "assistant", delta: captionTail });
			});
		}
		this.#chain = this.#chain.then(async () => {
			const incompleteResult = this.#resultFidelity.close();
			if (incompleteResult) await this.#recordResultFidelity(incompleteResult);
		});
		const pendingCaller = this.#openingInputs.flatMap(data => {
			try {
				const event = inspectVoiceEvent(JSON.parse(data), { sideband: true }).event;
				return event?.kind === "transcript" && event.role === "user" ? [event] : [];
			} catch {
				return [];
			}
		});
		if (pendingCaller.length) {
			this.#history ??=
				this.deps.history ??
				new VoiceHistory(
					this.#config?.realtimeSessionId ?? null,
					record => this.deps.record(record),
					(method, params) => this.deps.emit(method, params),
				);
			const history = this.#history;
			this.#chain = this.#chain.then(async () => {
				if (!history.engaged) await history.start(this.#config?.realtimeSessionId ?? null);
				for (const event of pendingCaller) {
					await this.deps.record({
						key: randomUUID(),
						kind: "transcript",
						role: "user",
						text: event.text,
						realtimeSessionId: this.#config?.realtimeSessionId ?? null,
						preservedDuringInitialization: true,
					});
					await history.transcript("user", event.text, event.done);
				}
			});
		}
		this.#finishPolicyDelivery("closed-unacknowledged", "none");
		const socket = this.#socket;
		const failed = reason === "failed" || reason === "transportClosed";
		this.#state = "closed";
		this.#handoff?.close();
		if (!this.#ownedCreation) this.#epoch++;
		clearTimeout(this.#reconnectTimer);
		clearInterval(this.#workStatusTimer);
		this.#outbound = [];
		this.#outboundBytes = 0;
		this.#openingInputs = [];
		this.#openingBytes = 0;
		this.#awaitingSession = false;

		this.#sessionReady?.reject(new Error("Voice stopped during session initialization"));
		this.#sessionReady = undefined;
		if (!this.#ownedCreation) this.#abort.abort();
		const endInstructions = this.#modeUpdates
			.catch(() => {})
			.then(async () => {
				if (this.#modeStarted) await this.deps.modeChanged?.(false, { ...this.#modeInstructions });
			})
			.catch(() => {
				this.deps.emit("thread/realtime/error", { message: "Could not apply voice end instructions" });
			});
		this.#socket = undefined;
		const finalization =
			this.#ownedCreation && socket
				? this.#finalization
						.close(
							() => socket.send(JSON.stringify({ type: "session.close" })),
							() => {
								this.#epoch++;
								this.#abort.abort();
								socket.close();
							},
							this.deps.closureTimeoutMs,
						)
						.then(async receipt => {
							this.#closureConfirmed = receipt.confirmed;
							await this.deps.record({
								kind: "voiceProviderClosure",
								providerCallId: this.#knownCall?.callId,
								...receipt,
							});
							this.deps.emit("xcsh/voice/closure", { ...receipt });
						})
				: Promise.resolve();
		if (socket && !this.#ownedCreation) {
			try {
				if (reason === "requested" || failed) socket.send(JSON.stringify({ type: "session.close" }));
			} catch {}
			socket.close();
		}
		this.#closing = Promise.all([
			finalization,
			this.#chain,
			endInstructions,
			this.#diagnosticsTail,
			this.#diagnostics?.close(failed ? "failed" : "closed"),
		])
			.then(async () => {
				await this.deps.record({ kind: "voiceAudioDiagnostic", ...this.#audioEvidence.snapshot() });
				await this.deps.record({
					kind: "voiceStartupAudioDiagnostic",
					realtimeSessionId: this.#config?.realtimeSessionId ?? null,
					...this.#startupAudioEvidence.snapshot(),
					callerObserved: this.#hasCallerInput,
				});
				await this.deps.record({
					kind: "voiceEventDiagnostic",
					eventTypes: Object.fromEntries(
						[...this.#eventTypes].sort(([left], [right]) => left.localeCompare(right)),
					),
					dispositions: Object.fromEntries(
						[...this.#eventDispositions].sort(([left], [right]) => left.localeCompare(right)),
					),
					rejections: Object.fromEntries(
						[...this.#eventRejections].sort(([left], [right]) => left.localeCompare(right)),
					),
				});
				await this.#history?.close(failed);
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
		const open: NonNullable<VoiceDependencies["open"]> =
			this.deps.open ??
			((url, headers, handlers, signal) =>
				process.env.XCSH_VOICE_UPGRADE_DIAGNOSTIC === "1"
					? openDiagnosticVoiceSocket(url, headers, handlers, traceFromEnvironment("voice", VERSION), signal)
					: openVoiceSocket(url, headers, handlers, undefined, signal));
		return open(
			this.#config!.url,
			headers,
			{
				message: data => {
					if (this.#epoch === epoch) this.#receive(data);
				},
				closed: () => {
					if (this.#epoch === epoch && this.#state === "closed") this.#finalization.lost();
					if (this.#epoch === epoch) this.#transportLost();
				},
			},
			this.#abort.signal,
		);
	}
	#transportLost(): void {
		if (!this.active) return;
		if (this.#policyDelivery) {
			this.#finishPolicyDelivery("transport-lost-unacknowledged", "none");
			void this.stop("transportClosed");
			return;
		}
		if (this.#awaitingSession) {
			this.#readinessLost = true;
			this.#sessionReady?.reject(new Error("Live session ended before readiness"));
			if (!this.#ready) {
				this.stop("transportClosed");
				return;
			}
		}
		if (this.#state === "reconnecting") return;
		if (this.#state !== "open" || this.#config?.kind === "websocket") {
			this.stop("transportClosed");
			return;
		}
		this.#state = "reconnecting";
		this.#diagnostics?.reconnect(process.env.XCSH_VOICE_EXPECTED_RECONNECT === "1");
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
			// The primary call already owns session initialization. As in the pinned
			// ExistingCall attachment, reconnect readiness is the authenticated
			// WebSocket upgrade; a second session.started event is not promised.
			this.#awaitingSession = false;
			this.#readinessLost = false;
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
			this.#awaitingSession = false;
			this.#sessionReady = undefined;
			if (this.#state !== "reconnecting") {
				socket.close();
				return;
			}
			this.#state = "open";
			this.#diagnostics?.transition("connected");
			this.#disableAcknowledgmentFiller();
			this.#connectedAt = Date.now();
			this.#drain();
			const openingInputs = this.#openingInputs;
			this.#openingInputs = [];
			this.#openingBytes = 0;
			for (const data of openingInputs) this.#receive(data);
			await this.deps.record({
				kind: "voiceDiagnostic",
				stage: "sideband-reconnect",
				connected: true,
				elapsedMs: Date.now() - startedAt,
			});
		} catch (error) {
			this.#awaitingSession = false;
			this.#sessionReady = undefined;
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
		this.#diagnosticQueues();
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
			this.#diagnosticQueues();
		}
	}

	/** Deliver the reserved startup policy once, before admitting the first caller's work. */
	/** Elapsed time inspects verified state; it never resubmits or cancels work. */
	inspectWorkStatus(): Promise<void> {
		return this.refreshContext();
	}
	/** Refresh verified application facts without initiating speech or backend work. */
	refreshContext(): Promise<void> {
		const epoch = this.#epoch;
		const pending = this.#contextRefreshTail.then(async () => {
			if (!this.#ready || !this.active || epoch !== this.#epoch) return;
			const snapshot = await this.deps.persona?.();
			if (!snapshot || !this.#ready || !this.active || epoch !== this.#epoch) return;
			if (!this.#hasCallerInput) return;
			const content = voiceRuntimeContext(snapshot);
			const hash = createHash("sha256").update(content).digest("hex");
			if (!content || hash === this.#runtimeContextHash) return;
			if (Buffer.byteLength(content) > 1900) throw new Error("Voice runtime context exceeds budget");
			this.#runtimeContextHash = hash;
			this.#send({ type: "session.context.append", content: [{ type: "input_text", text: content }] });
			await this.deps.record({ kind: "voiceRuntimeDiagnostic", runtimeContextSha256: hash, outcome: "queued" });
		});
		// Observer failure cannot poison later refreshes or trigger backend replay.
		this.#contextRefreshTail = pending.catch(() => {});
		return pending;
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
		if ((role !== "user" || speakable) && !this.#allowStartupContext(text, "appendText")) return;
		const send = () => {
			const outputText = speakable ? completedVoiceText(text) : text;
			for (const chunk of contextChunks(outputText))
				this.#send({
					type: "session.context.append",
					...(speakable ? { channel: "speakable" } : {}),
					content: [{ type: "input_text", text: chunk }],
				});
		};
		if (role === "user" && !speakable) {
			this.#hasCallerInput = true;
			this.#startupPolicy.observe("user", text, true);
		}
		send();
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
		if (this.#ownedCreation && Buffer.byteLength(data) <= 1_048_576) {
			try {
				if (this.#finalization.observe(JSON.parse(data))) {
					this.#closureConfirmed = true;
					if (this.active) void this.stop("providerClosed");
					return;
				}
			} catch {
				/* The normal parser preserves malformed input diagnostics. */
			}
		}
		if (!this.active) return;
		const bytes = Buffer.byteLength(data);
		if (this.#seen.size >= 8192 || bytes > 1_048_576 || this.#pendingBytes + this.#openingBytes + bytes > 2_097_152) {
			this.#countEvent("invalid", "rejected", "droppedFrame");
			this.#fail("Realtime input buffer limit reached");
			return;
		}
		// Instruction delivery is independent of connection readiness and user work.
		// Observe correlated commands even before queued conversation traffic drains.
		if (this.#policyDelivery) {
			try {
				const input = JSON.parse(data);
				const decoded = inspectVoiceEvent(input, { sideband: this.#config?.kind === "existingCall" });
				if (
					decoded.eventType === "session.instructions.appended" &&
					decoded.disposition === "observed" &&
					input.client_event_id === this.#policyDelivery.eventId
				) {
					this.#inspectEvent(input);
					this.#finishPolicyDelivery("acknowledged", "client_event_id");
					return;
				}
				if (decoded.event?.kind === "error" && input.error?.client_event_id === this.#policyDelivery.eventId) {
					this.#inspectEvent(input);
					this.#finishPolicyDelivery("rejected", "error.client_event_id");
					this.#fail("Live provider rejected voice instructions");
					return;
				}
			} catch {
				/* Normal event decoding below records malformed input. */
			}
		}
		if (this.#awaitingSession) {
			let input: unknown;
			try {
				input = JSON.parse(data);
			} catch {
				this.#countEvent("invalid", "rejected", "invalidJson");
				this.#awaitingSession = false;
				this.#sessionReady?.reject(new Error("Malformed Live event before readiness"));
				return;
			}
			const decoded = this.#inspectEvent(input);
			if (decoded.disposition === "observed") return;
			if (decoded.disposition === "rejected" || !decoded.event) {
				this.#sessionReady?.reject(new Error("Malformed Live event before readiness"));
				return;
			}
			if (
				decoded.event.kind === "sessionUpdated" &&
				(decoded.eventType === "session.started" || decoded.eventType === "session.created")
			) {
				this.#sessionReady?.resolve();
			} else if (decoded.event.kind === "error") {
				this.#sessionReady?.reject(new Error("Live provider rejected a command"));
			} else {
				// Valid traffic may race the readiness event. Preserve it for
				// ordered processing once the Live readiness event opens the gate.
				this.#openingInputs.push(data);
				this.#openingBytes += bytes;
				this.#diagnosticQueues();
			}
			return;
		}
		if (!this.#ready) {
			this.#openingInputs.push(data);
			this.#openingBytes += bytes;
			this.#diagnosticQueues();
			return;
		}
		this.#pendingBytes += bytes;
		this.#diagnosticQueues();
		this.#chain = this.#chain
			.then(async () => {
				if (!this.#config) return;
				let input: unknown;
				try {
					input = JSON.parse(data);
				} catch {
					this.#countEvent("invalid", "rejected", "invalidJson");
					this.#fail("Malformed realtime event");
					return;
				}
				const decoded = this.#inspectEvent(input);
				if (decoded.disposition === "handled" && decoded.event) await this.#event(decoded.event);
			})
			.catch(() => this.#fail())
			.finally(() => {
				this.#pendingBytes -= bytes;
				this.#diagnosticQueues();
			});
	}
	#countEvent(
		type: string,
		disposition: VoiceEventDecode["disposition"],
		rejection?: VoiceEventRejection | "invalidJson" | "droppedFrame",
	): void {
		this.#eventTypes.set(type, (this.#eventTypes.get(type) ?? 0) + 1);
		this.#eventDispositions.set(disposition, (this.#eventDispositions.get(disposition) ?? 0) + 1);
		if (rejection) this.#eventRejections.set(rejection, (this.#eventRejections.get(rejection) ?? 0) + 1);
		this.#diagnostics?.event(type, disposition, rejection);
	}
	#recordPolicyDelivery(outcome: string, correlation: string): Promise<void> {
		const delivery = this.#policyDelivery;
		if (!delivery) return Promise.resolve();
		return this.deps.record({
			kind: "voiceInstructionDelivery",
			policySha256: delivery.policySha256,
			policyVersion: VOICE_POLICY.version,
			transport: delivery.transport,
			eventIdSha256: createHash("sha256").update(delivery.eventId).digest("hex"),
			correlation,
			outcome,
			spokenBehaviorVerified: false,
		});
	}
	#finishPolicyDelivery(outcome: string, correlation: string): void {
		const receipt = this.#recordPolicyDelivery(outcome, correlation);
		this.#policyDelivery = undefined;
		this.#diagnosticsTail = this.#diagnosticsTail.then(() => receipt);
	}
	#disableAcknowledgmentFiller(): void {
		if (this.#config?.kind !== "existingCall" || !this.#socket) return;
		this.#acknowledgmentControlPending = true;
		this.#socket.send(
			JSON.stringify({
				type: "session.update",
				session: { delegation: { type: "client", ack_filler: false } },
			}),
		);
	}
	#inspectEvent(input: unknown): VoiceEventDecode {
		const audio = input as { type?: string; delta?: unknown };
		if (audio.type === "session.output_audio.delta" && typeof audio.delta === "string") {
			this.#audioEvidence.observe(audio.delta);
			if (!this.#hasCallerInput) this.#startupAudioEvidence.observe(audio.delta);
		}
		const frame = input as { type?: string; turn?: { role?: string }; item?: { text?: string } };
		if (
			(frame.type === "turn.created" && frame.turn?.role === "user") ||
			frame.type === "input_audio_buffer.speech_started"
		) {
			this.#callerTurnOpen = true;
			this.#prematureSpeechReported = false;
		} else if (
			(frame.type === "turn.done" && frame.turn?.role === "user") ||
			frame.type === "input_audio_buffer.speech_stopped"
		) {
			this.#callerTurnOpen = false;
		}
		if (
			frame.type === "output_transcript.added" &&
			frame.item?.text?.trim() &&
			this.#callerTurnOpen &&
			!this.#prematureSpeechReported
		) {
			this.#prematureSpeechReported = true;
			this.#diagnosticsTail = this.#diagnosticsTail
				.then(() =>
					this.deps.record({
						kind: "voiceTurnTakingDiagnostic",
						assistantBeforeCallerTurnCompleted: true,
						existingCall: this.#config?.kind === "existingCall",
						sourceTextSha256: createHash("sha256").update(frame.item!.text!).digest("hex"),
					}),
				)
				.catch(() => {});
		}
		const decoded = inspectVoiceEvent(input, { sideband: this.#config?.kind === "existingCall" });
		if (decoded.event?.kind === "error") {
			const error = (input as { error?: Record<string, unknown> }).error ?? {};
			const code = typeof error.code === "string" && providerErrorCodes.has(error.code) ? error.code : null;
			const errorType = typeof error.type === "string" && providerErrorTypes.has(error.type) ? error.type : null;
			const param = typeof error.param === "string" && providerErrorParams.has(error.param) ? error.param : null;
			const message = typeof error.message === "string" ? error.message : "";
			const diagnostic = {
				kind: "voiceProviderErrorDiagnostic",
				providerErrorType: errorType,
				providerErrorCode: code,
				providerErrorParam: param,
				policyCommandMatched: !!this.#policyDelivery && error.client_event_id === this.#policyDelivery.eventId,
				policyCommandType:
					this.#policyDelivery && error.client_event_id === this.#policyDelivery.eventId
						? "session.instructions.append"
						: null,
				commandCorrelation: typeof error.client_event_id === "string" ? "error.client_event_id" : "unavailable",
				failedPolicyEventIdSha256:
					this.#policyDelivery && error.client_event_id === this.#policyDelivery.eventId
						? createHash("sha256").update(this.#policyDelivery.eventId).digest("hex")
						: null,
				messageSha256: createHash("sha256").update(message).digest("hex"),
				messageBytes: Buffer.byteLength(message),
				referencedProtocolCommands: voiceProtocolCommands.filter(command => message.includes(command)),
			};
			this.#diagnosticsTail = this.#diagnosticsTail.then(() => this.deps.record(diagnostic)).catch(() => {});
		}

		if (decoded.event?.kind === "sessionUpdated") {
			if ((input as { type?: string }).type === "session.updated" && this.#acknowledgmentControlPending) {
				this.#acknowledgmentControlPending = false;
				this.#diagnosticsTail = this.#diagnosticsTail
					.then(() =>
						this.deps.record({ kind: "voiceAcknowledgmentFiller", enabled: false, providerAcknowledged: true }),
					)
					.catch(() => {});
			}

			const model = (input as { session?: { model?: unknown } }).session?.model;
			if (this.#ownedCreation && model !== undefined) {
				this.#ownedCreation.providerModel = typeof model === "string" ? model : "invalid-model-echo";
				const evidence = evaluateVoiceContract({ creation: this.#ownedCreation });
				this.#diagnosticsTail = this.#diagnosticsTail
					.then(() => this.deps.record({ kind: "voiceContractEvidence", ...evidence }))
					.catch(() => {});
				if (evidence.modelEcho === "conflicting")
					this.#fail("The provider returned conflicting voice model evidence");
			}
			if (typeof model === "string" && /^gpt-[a-zA-Z0-9._-]{1,120}$/.test(model)) {
				this.#diagnosticsTail = this.#diagnosticsTail
					.then(() =>
						this.deps.record({
							kind: "voiceModelDiagnostic",
							observedModel: model,
							eventType: decoded.eventType,
						}),
					)
					.catch(() => {});
			}
		}
		this.#countEvent(decoded.eventType, decoded.disposition, decoded.rejection);
		if (decoded.disposition !== "rejected" && !this.#firstEventRecorded) {
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
		return decoded;
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
		if (this.#startupViolation) return;
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
			if (event.role === "assistant") this.#captionBranding.reset();
			if (event.role === "user") this.#answeredInteraction = undefined;
			this.#newTranscriptEntry[event.role] = true;
			return;
		}
		if (event.kind === "transcript") {
			const transcriptKey = event.done ? this.#key("transcript", event.id ?? randomUUID()) : undefined;
			if (transcriptKey && this.#seen.has(transcriptKey)) return;
			if (event.role === "user" && this.#newTranscriptEntry.user) this.#answeredInteraction = undefined;
			const finalCaption =
				event.role === "assistant" && event.done ? this.#captionBranding.finish(event.text) : undefined;
			const captionText =
				event.role === "assistant" ? (finalCaption?.text ?? this.#captionBranding.append(event.text)) : event.text;
			this.#trackTranscript(event);
			if (event.role === "assistant" && isSniffAnnotation(event.text))
				await this.deps.record({
					kind: "voiceAnnotationDiagnostic",
					annotation: "sniff",
					audioEvidence: this.#audioEvidence.snapshot(),
					beforeCaller: !this.#hasCallerInput,
				});
			const startupViolation = this.#startupPolicy.observe(event.role, event.text, event.done);
			if (startupViolation) {
				this.#startupViolation = true;
				this.#flushTail = false;
				// Preserve the offending streamed speech even if the provider never finalizes its turn.
				if (captionText) await this.#history?.transcript(event.role, captionText, event.done);
				await this.deps.record({
					kind: "startupPolicyViolation",
					reason: startupViolation,
					realtimeSessionId: this.#config?.realtimeSessionId,
					backendWorkAdmitted: this.#pendingDelegations > 0,
					audioEvidence: this.#audioEvidence.snapshot(),
					sourceTextSha256: createHash("sha256").update(event.text).digest("hex"),
				});
				this.#fail("Voice startup violated xcsh identity or caller-turn policy. Please start a new call.");
				return;
			}

			const fidelity = this.#resultFidelity.observe(event.role, event.text, event.done, event.id);
			if (fidelity) await this.#recordResultFidelity(fidelity);
			if (!event.done && !captionText) return;
			if (event.role === "user" && event.text.trim()) this.#hasCallerInput = true;
			if (event.done) {
				const key = transcriptKey!;
				this.#seen.add(key);
				await this.deps.record({
					key,
					kind: "transcript",
					realtimeSessionId: this.#config?.realtimeSessionId,
					role: event.role,
					text: captionText,
					...(captionText !== event.text ? { sourceText: event.text, captionFormat: "xcsh-branding-v1" } : {}),
				});
				if (event.role === "assistant" && event.text.trim())
					try {
						this.deps.title?.(captionText);
					} catch {
						// Title generation is presentation-only and must not fail voice.
					}
			}
			if (finalCaption?.delta) {
				await this.#history?.transcript("assistant", finalCaption.delta, false);
				this.deps.emit("thread/realtime/transcript/delta", { role: "assistant", delta: finalCaption.delta });
			}
			await this.#history?.transcript(event.role, captionText, event.done);
			if (event.done && this.#ownedCreation && (await this.deps.completedTranscript?.(event.role, captionText))) {
				this.#answeredInteraction = captionText.trim().toLowerCase();
				// The interaction owner consumed this exchange. Its durable transcript remains,
				// but neither a later handoff nor end-of-call tail flushing may resubmit it.
				this.#tail = [];
				this.#newTranscriptEntry = { user: true, assistant: true };
			}

			if (!this.active) return;
			this.deps.emit(`thread/realtime/transcript/${event.done ? "done" : "delta"}`, {
				role: event.role,
				[event.done ? "text" : "delta"]: captionText,
			});
			return;
		}
		const key = this.#key("delegation", event.id);
		if (this.#seen.has(key)) {
			if (this.#uncertainDelegations.delete(key)) {
				await this.deps.record({ key, kind: "delegationRecovery", state: "reconciliationRequired" });
				if (this.active)
					this.deps.emit("thread/realtime/error", {
						message:
							"The previous request has an uncertain outcome. Check its task and resource state before retrying.",
					});
			}
			return;
		}
		// An empty handoff is valid only when this unconsumed exchange contains
		// actual caller text. A provider turn reference is not caller input.
		if (!event.text.trim() && !this.#tail.some(entry => entry.role === "user" && entry.text.trim())) {
			this.#seen.add(key);
			await this.deps.record({ key, kind: "delegationSuppressed", reason: "noCallerRequest" });
			this.#send({
				type: "delegation.context.append",
				delegation_item_id: event.id,
				content: [
					{
						type: "input_text",
						text: "No caller request was observed. No backend work was admitted. Keep listening until the caller speaks.",
					},
				],
			});
			return;
		}
		if (!this.#hasCallerInput && this.deps.isStartupHistoryRequest?.(event.text)) {
			this.#seen.add(key);
			await this.deps.record({ key, kind: "delegationSuppressed", reason: "startupHistoryReplay" });
			// Return quiet factual context so Live retires the handoff without
			// speaking a recovery message or fabricating a completed action.
			this.#send({
				type: "delegation.context.append",
				delegation_item_id: event.id,
				content: [
					{
						type: "input_text",
						text: "This is a previous typed request. No new caller input was observed and no work was admitted. Wait for the caller's next request.",
					},
				],
			});
			return;
		}
		// The pinned delegation commits its input before the whole input turn ends.
		// Offer matching observed caller text only to the non-authorizing control owner.
		const committedInput = event.text.trim();
		if (
			this.#ownedCreation &&
			committedInput &&
			!this.#answeredInteraction &&
			this.#tail.some(
				entry => entry.role === "user" && entry.text.trim().toLowerCase() === committedInput.toLowerCase(),
			) &&
			(await this.deps.committedCallerControl?.(committedInput))
		) {
			this.#answeredInteraction = committedInput.toLowerCase();
			this.#tail = [];
			this.#newTranscriptEntry = { user: true, assistant: true };
		}
		if (this.#answeredInteraction && event.text.trim().toLowerCase() === this.#answeredInteraction) {
			this.#seen.add(key);
			await this.deps.record({ key, kind: "voiceInteractionDelegation", outcome: "already-resolved-no-submission" });
			this.#send({
				type: "delegation.context.append",
				delegation_item_id: event.id,
				content: [
					{
						type: "input_text",
						text: "The interaction owner already resolved this answer. No new backend task was admitted.",
					},
				],
			});
			return;
		}
		if (this.#pendingDelegations >= 16 || this.#seen.size >= 8192) {
			this.#fail("Realtime delegation limit reached");
			return;
		}
		// A genuine handoff can precede transcript delivery. Apply the same gate
		// after excluding empty or replayed startup requests, before any work.
		if (event.text.trim()) {
			this.#hasCallerInput = true;
			this.#startupPolicy.observe("user", event.text, true);
			if (!this.active) return;
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
		this.#diagnostics?.delegation({ active: true, pending: this.#pendingDelegations, supersededExecutions: 0 });
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
		// Attach settlement handlers immediately: persistence can fail after admission.
		void delegated
			.then(
				async text => {
					if (this.#activeHandoffId === event.id) this.#activeHandoffId = undefined;
					await this.deps.record({ key, kind: "delegationResult", text }).catch(() => {
						this.deps.emit("thread/realtime/error", {
							message:
								"The result is verified, but its evidence could not be recorded. Do not replay the operation.",
							failureClass: "evidenceCollector",
						});
					});
					if (this.#config?.clientManagedHandoffs || !this.active) return;
					handoff?.finish(text);
				},
				async (error: unknown) => {
					const details = error as { codexErrorInfo?: unknown; voiceHandoffRetired?: unknown } | null;
					if (details?.voiceHandoffRetired === true) return;
					await this.deps
						.record({ key, kind: "delegationFailure", failureClass: "execution", outcome: "unresolved" })
						.catch(() => {
							this.deps.emit("thread/realtime/error", {
								message: "Execution evidence could not be recorded. Reconcile the task before retrying.",
								failureClass: "evidenceCollector",
							});
						});
					handoff?.finish(
						"The backing agent could not complete the request. This is a backend task failure, not a diagnosed infrastructure problem. Its outcome is unresolved; inspect completed task steps before retrying, and do not replay completed actions.",
					);
					if (details?.codexErrorInfo === "misalignmentPolicyViolation") this.#handoffsRetired = true;
					// The phone treats thread/realtime/error as a failed call and
					// closes its healthy media connection. Execution failure belongs
					// to the durable task and its speakable recovery result above.
				},
			)
			.catch(() => {
				if (this.active)
					this.deps.emit("thread/realtime/error", {
						message:
							"The verified task result could not be delivered to voice. Check the durable task history; do not replay the operation.",
						failureClass: "transportProvider",
					});
			})
			.finally(() => {
				if (this.#activeHandoffId === event.id) this.#activeHandoffId = undefined;
				this.#pendingDelegations--;
				this.#diagnostics?.delegation({
					active: this.#pendingDelegations > 0,
					pending: this.#pendingDelegations,
					supersededExecutions: 0,
				});
			});
		await this.deps.record({
			key,
			kind: "delegation",
			state: "submitted",
			realtimeSessionId: this.#config?.realtimeSessionId,
		});
	}
	async #recordResultFidelity(fidelity: VoiceResultFidelityObservation): Promise<void> {
		const { delegationId, ...observation } = fidelity;
		try {
			await this.deps.record({
				kind: "voiceResultFidelity",
				...observation,
				delegationIdSha256: createHash("sha256").update(delegationId).digest("hex"),
				realtimeSessionId: this.#config?.realtimeSessionId,
			});
		} catch {
			this.deps.emit("thread/realtime/error", {
				message: "Voice result fidelity evidence could not be recorded. Do not replay the completed task.",
				failureClass: "evidenceCollector",
			});
		}
	}
	#createHandoff(id: string): VoiceHandoff | CompletedVoiceHandoff | undefined {
		if (this.#config?.clientManagedHandoffs) return;
		if (this.#handoffOptions.asItems)
			return new CompletedVoiceHandoff((text, phase) => this.#sendCompletedOutput(text, phase, id));
		const speechItems = new Map<string, string>();
		return new VoiceHandoff(this.#handoffOptions, (channel, text, final, itemId) => {
			if (channel !== "commentary") {
				const buffered = speechItems.get(itemId);
				const partialProduct = /(?:^|[\s\]])x(?:c(?:s(?:h)?)?)?$/iu.test(text);
				const incompleteQuote = (text.match(/[`"“”]/g)?.length ?? 0) % 2 === 1;
				if (buffered !== undefined || (!final && (/xcsh/iu.test(text) || partialProduct || incompleteQuote))) {
					text = (buffered ?? "") + text;
					if (!final) {
						speechItems.set(itemId, text);
						return;
					}
					speechItems.delete(itemId);
				}
			}
			if (channel !== "commentary") {
				const result = voiceResultInstructions(text);
				text = result.text;
				if (result.names.length) {
					const previous = this.#resultFidelity.expect(id, result.names);
					if (previous)
						this.#diagnosticsTail = this.#diagnosticsTail.then(() => this.#recordResultFidelity(previous));
				}
			}
			for (const chunk of contextChunks(voicePronunciationInstructions(text)))
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
		if (!this.#allowStartupContext(text, "mirrorText")) return;
		this.#sendCompletedOutput(text, phase, this.#activeHandoffId);
	}
	#allowStartupContext(text: string, source: string): boolean {
		if (this.#hasCallerInput) return true;
		this.#diagnosticsTail = this.#diagnosticsTail
			.then(() =>
				this.deps.record({
					kind: "startupContextSuppressed",
					source,
					reason: "callerFirst",
					audioEvidence: this.#audioEvidence.snapshot(),
					sourceTextSha256: createHash("sha256").update(text).digest("hex"),
					bytes: Buffer.byteLength(text),
				}),
			)
			.catch(() => {});
		return false;
	}
	#sendCompletedOutput(text: string, phase?: HandoffPhase, handoffId?: string): void {
		const options = this.#handoffOptions;
		if (options.mode === "bemTags") phase = handoffPhase(text, options.prefixes) ?? "final_answer";
		let output = completedVoiceText(text);
		if (options.asItems && options.itemPrefix) output = completedVoiceText(`${options.itemPrefix}\n\n${output}`);
		const channel = handoffChannel(options, phase);
		if (phase !== "commentary") {
			const result = voiceResultInstructions(output);
			output = result.text;
			if (handoffId !== undefined) {
				const previous = this.#resultFidelity.expect(handoffId, result.names);
				if (previous)
					this.#diagnosticsTail = this.#diagnosticsTail.then(() => this.#recordResultFidelity(previous));
			}
		}
		for (const chunk of contextChunks(voicePronunciationInstructions(output)))
			this.#send({
				type: options.asItems || handoffId === undefined ? "session.context.append" : "delegation.context.append",
				...(!options.asItems && handoffId !== undefined ? { delegation_item_id: handoffId } : {}),
				...(channel ? { channel } : {}),
				content: [{ type: "input_text", text: chunk }],
			});
	}
}
