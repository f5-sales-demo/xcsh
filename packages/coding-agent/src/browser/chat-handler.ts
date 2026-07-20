import type { AssistantMessage } from "@f5-sales-demo/pi-ai";
import { DEFAULT_MODEL_ROLE } from "../config/settings-schema";
import {
	isRpcHostToolResult,
	isRpcHostToolUpdate,
	normalizeHostToolDefinitions,
	RpcHostToolBridge,
} from "../host-tools";
import type { AgentSession, AgentSessionEvent } from "../session/agent-session";
import {
	type ChatDelta,
	type ChatDone,
	type ChatError,
	type ChatErrorReason,
	type ChatKeepalive,
	type ChatReference,
	type ChatRequest,
	type Configure,
	type ConfigureAck,
	type ConfigureError,
	type HostToolResult,
	type HostToolUpdate,
	type InteractionMode,
	isChatRequest,
	isChatStop,
	isConfigure,
	isSetHostTools,
	type PageContextSnapshot,
	type SetHostTools,
	type SetHostToolsAck,
	type SetHostToolsError,
} from "./chat-protocol";
import { CONSOLE_ROUTES } from "./console-routes.generated";
import type { BridgeServer } from "./extension-bridge";
import { interpretPageState } from "./page-state-interpreter";
import { chatSpans } from "./ttft-spans";

/** Minimum spacing between chat_keepalive liveness frames during a long think.
 * Far below the panel's first-token timeout (120s) so a couple of missed frames
 * never trip a false abort, yet sparse enough to not spam the wire on rapid
 * thinking deltas. */
export const KEEPALIVE_INTERVAL_MS = 10_000;

/** Throttle gate for chat_keepalive: send when at least KEEPALIVE_INTERVAL_MS has
 * elapsed since the last one (lastKeepaliveAt = 0 means none yet → always true, so
 * the first thinking delta immediately proves liveness to the panel). */
export function shouldSendKeepalive(nowMs: number, lastKeepaliveAt: number): boolean {
	return nowMs - lastKeepaliveAt >= KEEPALIVE_INTERVAL_MS;
}

interface ActiveChat {
	id: string;
	seq: number;
	terminalSent: boolean;
	unsubscribe: () => void;
	entryAt: number;
	promptAt: number | null;
	spanEmitted: boolean;
	/** Wall-clock of the last chat_keepalive sent, to throttle liveness frames during
	 * a long pre-first-token think (0 = none sent yet). */
	lastKeepaliveAt: number;
}

export class ChatHandler {
	#server: BridgeServer;
	#session: AgentSession;
	#activeChats = new Map<string, ActiveChat>();
	#activeHistoryHint: string | undefined;
	#onTurnStart: (() => void) | undefined;
	// Queued next request: when the session is busy (a turn is in flight), the next
	// prompt is stashed here and replayed automatically when the current turn finishes.
	// Only one pending request at a time (newest wins — a third prompt while one is
	// queued replaces it, so the user's latest intent always runs next).
	#pendingRequest: ChatRequest | null = null;
	// Transport-neutral host-tool bridge (A1): maps `set_host_tools` definitions to
	// AgentTools whose execute() round-trips a `host_tool_call` back to the WS client
	// and awaits the correlated `host_tool_result`. Reused verbatim from the stdio RPC
	// driver — the only WS-specific wiring is the `send()` output sink below.
	#hostToolBridge: RpcHostToolBridge;

	constructor(server: BridgeServer, session: AgentSession) {
		this.#server = server;
		this.#session = session;
		this.#hostToolBridge = new RpcHostToolBridge(frame => this.#server.send(frame));
	}

	/** Register a callback fired when a chat turn is accepted (used by the worker's
	 * manager keepalive to refresh lastSeen at turn start). */
	onTurnStart(cb: () => void): void {
		this.#onTurnStart = cb;
	}

	attach(): void {
		this.#server.onMessage(msg => {
			if (isChatRequest(msg)) this.#handleChatRequest(msg as unknown as ChatRequest);
			else if (isChatStop(msg)) this.#handleChatStop(msg as unknown as { id: string });
			// Host-tool channel (#2046): register client tools, then route the client's
			// result/update frames back to the correlated pending call in the bridge.
			else if (isSetHostTools(msg)) this.#handleSetHostTools(msg as unknown as SetHostTools);
			// Provider configuration channel (#2095): swap the LLM provider/model in
			// session memory at runtime (never persisted), then ack or nack.
			else if (isConfigure(msg)) this.#handleConfigure(msg as unknown as Configure);
			else if (isRpcHostToolResult(msg)) this.#hostToolBridge.handleResult(msg as unknown as HostToolResult);
			else if (isRpcHostToolUpdate(msg)) this.#hostToolBridge.handleUpdate(msg as unknown as HostToolUpdate);
		});

		this.#server.onDisconnected(() => {
			this.#pendingRequest = null; // abandon any queued prompt — the bridge is gone
			// Fail any in-flight host-tool call — the client that would answer it is gone.
			this.#hostToolBridge.rejectAllPending("bridge disconnected before host tool completed");
			for (const chat of this.#activeChats.values()) {
				this.#sendTerminal(chat, {
					type: "chat_error",
					id: chat.id,
					error: "bridge disconnected",
					reason: "bridge-disconnected",
				});
				chat.unsubscribe();
			}
			this.#activeChats.clear();
		});
	}

	async #handleChatRequest(req: ChatRequest): Promise<void> {
		const { id } = req;

		if (this.#session.isStreaming || this.#activeChats.size > 0) {
			// Queue instead of reject: stash this request and replay it automatically
			// when the current turn finishes. Newest wins (a third prompt while one is
			// queued replaces it, so the user's latest intent always runs next). Send a
			// tool-notice so the panel clears its timeout and shows "queued."
			this.#pendingRequest = req;
			this.#server.send({
				type: "chat_tool_notice",
				id,
				tool: "queue",
				ok: true,
				detail: "xcsh is finishing the current request — yours is queued and will run next.",
			});
			return;
		}

		if (req.history_hint && req.history_hint !== this.#activeHistoryHint) {
			this.#session.agent.replaceMessages([]);
			this.#activeHistoryHint = req.history_hint;
		}

		const chat: ActiveChat = {
			id,
			seq: 0,
			terminalSent: false,
			unsubscribe: () => {},
			entryAt: Date.now(),
			promptAt: null,
			spanEmitted: false,
			lastKeepaliveAt: 0,
		};
		this.#activeChats.set(id, chat);
		this.#onTurnStart?.();

		const unsubscribe = this.#session.subscribe((event: AgentSessionEvent) => {
			this.#handleSessionEvent(chat, event);
		});
		chat.unsubscribe = unsubscribe;

		const prompt = composeChatPrompt(req.text, req.context, req.mode);

		try {
			chat.promptAt = Date.now();
			await this.#session.prompt(prompt, { expandPromptTemplates: false, synthetic: false });
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "unknown error";
			this.#sendTerminal(chat, { type: "chat_error", id, error: message, reason: classifyChatErrorReason(message) });
		} finally {
			if (!chat.terminalSent) {
				this.#sendTerminal(chat, { type: "chat_done", id });
			}
			chat.unsubscribe();
			this.#activeChats.delete(id);
			// Replay a queued request now that this turn is done: the session is free,
			// so the pending prompt runs immediately (no user re-send needed).
			const pending = this.#pendingRequest;
			if (pending) {
				this.#pendingRequest = null;
				void this.#handleChatRequest(pending);
			}
		}
	}

	#handleSessionEvent(chat: ActiveChat, event: AgentSessionEvent): void {
		if (chat.terminalSent) return;

		// TOOL-ACTIVITY STREAMING: forward tool execution events as chat_tool_notice
		// so the panel shows inline activity cards ("catalog_workflow_runner: running…")
		// instead of eternal "● ● ● thinking" during multi-step tool use.
		if (event.type === "tool_execution_start" && "toolName" in event) {
			this.#server.send({
				type: "chat_tool_notice",
				id: chat.id,
				tool: String(event.toolName),
				ok: true,
				detail: `${event.toolName}: running…`,
			});
			return;
		}
		if (event.type === "tool_execution_end" && "toolName" in event) {
			this.#server.send({
				type: "chat_tool_notice",
				id: chat.id,
				tool: String(event.toolName),
				ok: !("error" in event && event.error),
				detail: `${event.toolName}: ${"error" in event && event.error ? "failed" : "done"}`,
			});
			return;
		}

		if (event.type === "message_update" && "assistantMessageEvent" in event) {
			const ame = event.assistantMessageEvent;
			if (ame.type === "text_delta") {
				this.#server.send({
					type: "chat_delta",
					id: chat.id,
					seq: chat.seq++,
					delta: ame.delta,
				} satisfies ChatDelta);
				// TTFT Phase 2: first token out — emit the chat-segment spans once, keyed by
				// the c- turn id. chat.promptAt is set (prompt() was awaited before any event);
				// guard against re-emit on later deltas.
				if (!chat.spanEmitted && chat.promptAt !== null) {
					chat.spanEmitted = true;
					for (const s of chatSpans(chat.id, chat.entryAt, chat.promptAt, Date.now())) {
						this.#server.send(s);
					}
				}
			} else if (ame.type === "thinking_delta") {
				// LIVENESS: the model is streaming extended thinking before any visible
				// token. Emit a throttled chat_keepalive so the panel re-arms its
				// first-token timer — a long legitimate think must not be mistaken for a
				// dead worker (#1994). Throttled so a burst of thinking deltas doesn't spam
				// the wire; the interval is far below the panel's first-token timeout.
				const nowMs = Date.now();
				if (shouldSendKeepalive(nowMs, chat.lastKeepaliveAt)) {
					chat.lastKeepaliveAt = nowMs;
					this.#server.send({ type: "chat_keepalive", id: chat.id } satisfies ChatKeepalive);
				}
			}
		} else if (event.type === "message_end" && event.message.role === "assistant") {
			const msg = event.message as AssistantMessage;
			if (msg.stopReason === "error") {
				const errorMsg = msg.errorMessage ?? "assistant error";
				this.#sendTerminal(chat, {
					type: "chat_error",
					id: chat.id,
					error: errorMsg,
					reason: classifyChatErrorReason(errorMsg),
				});
			} else if (msg.stopReason === "toolUse" || msg.content.some(part => part.type === "toolCall")) {
				// INTERMEDIATE tool-use step: the agent loop emits message_end for this
				// assistant message BEFORE running the tool. Do NOT terminate the turn here
				// — that would drop the tool notices, the tool round-trip, and the post-tool
				// narration under the terminalSent guard. The single chat_done fires on the
				// FINAL assistant message_end below (normal completion), with the finally
				// backstop in #handleChatRequest guaranteeing exactly-once terminal semantics.
				return;
			} else {
				const references = extractReferences(msg);
				this.#sendTerminal(chat, {
					type: "chat_done",
					id: chat.id,
					...(references.length > 0 ? { references } : {}),
				});
			}
		}
	}

	/** Register the client's host tools with the session, then ack so the client can
	 * await registration before its first prompt. Mirrors the stdio `set_host_tools`
	 * command handler (rpc-mode.ts): normalize → bridge.setTools → refreshRpcHostTools. */
	async #handleSetHostTools(msg: SetHostTools): Promise<void> {
		try {
			const tools = normalizeHostToolDefinitions(msg.tools);
			const rpcTools = this.#hostToolBridge.setTools(tools);
			await this.#session.refreshRpcHostTools(rpcTools);
			this.#server.send({
				type: "set_host_tools_ack",
				toolNames: tools.map(tool => tool.name),
			} satisfies SetHostToolsAck);
		} catch (err) {
			// Nack instead of throwing (stdio parity — rpc-mode nacks): a client
			// awaiting set_host_tools_ack would otherwise hang on malformed input.
			this.#server.send({
				type: "set_host_tools_error",
				error: err instanceof Error ? err.message : String(err),
			} satisfies SetHostToolsError);
		}
	}

	/** Configure the LLM provider at runtime from a bridge client (#2095), then ack
	 * with the selected model so the client can await it before its first prompt.
	 * SESSION/RUNTIME MEMORY ONLY — the token is never written to models.yml or the
	 * SQLite credential store. Mirrors #handleSetHostTools's try/ack-or-nack shape;
	 * never throws out of the handler (a nack keeps a waiting client from hanging).
	 *
	 * The baked F5 gateway registers its models under the "anthropic" provider
	 * (DEFAULT_MODEL_ROLE = "anthropic/claude-opus-4-8"), so that is the provider we
	 * (re)configure here. */
	async #handleConfigure(msg: Configure): Promise<void> {
		try {
			const registry = this.#session.modelRegistry;
			const [provider, defaultModelId] = DEFAULT_MODEL_ROLE.split("/");

			if (msg.baseUrl) {
				// SSRF guard: only an `https:` gateway URL may be dialed. Validate BEFORE
				// registerProvider so a bad URL becomes a configure_error nack (never a
				// silently-ignored frame that hangs the client). We deliberately do NOT
				// block loopback/RFC-1918 targets: an operator-chosen INTERNAL gateway is
				// the whole point (the F5 LiteLLM gateway, and the claude-office CORS proxy
				// at https://127-0-0-1.local-ip.sh:8443 are legitimate targets).
				//
				// Accepted residual (user-requested tradeoff): the operator points xcsh at
				// THEIR OWN gateway with THEIR OWN token over a loopback-only, TLS,
				// Origin-checked bridge (extension-bridge `isAllowedBridgeOrigin`), https is
				// enforced here, and the token is session-only (never persisted to disk).
				const baseUrl = requireHttpsUrl(msg.baseUrl);

				// baseUrl + apiKey, no models[] → sets the in-memory runtime API key AND
				// overrides the existing provider models' baseUrl/headers (reusing their
				// metadata). Nothing is persisted to disk.
				registry.registerProvider(
					provider,
					{
						baseUrl,
						apiKey: msg.token,
						headers: { "anthropic-beta": "context-1m-2025-08-07" },
					},
					"office-configure",
				);
			} else {
				// Key-only: reuse the baked F5 gateway; set just the non-persistent runtime key.
				registry.authStorage.setRuntimeApiKey(provider, msg.token);
			}

			const modelId = msg.model ?? this.#session.model?.id ?? defaultModelId;
			const model = registry.find(provider, modelId);
			if (!model) {
				throw new Error(`No model ${provider}/${modelId} available`);
			}
			// setModel validates the API key and throws if missing → becomes configure_error.
			await this.#session.setModel(model);

			this.#server.send({ type: "configure_ack", model: model.id } satisfies ConfigureAck);
		} catch (err) {
			// Nack instead of throwing (set_host_tools parity): a client awaiting
			// configure_ack would otherwise hang on a bad frame or missing key.
			this.#server.send({
				type: "configure_error",
				error: err instanceof Error ? err.message : String(err),
			} satisfies ConfigureError);
		}
	}

	#handleChatStop(stop: { id: string }): void {
		const chat = this.#activeChats.get(stop.id);
		if (!chat) return;
		this.#session.agent.abort();
	}

	#sendTerminal(chat: ActiveChat, frame: ChatDone | ChatError): void {
		if (chat.terminalSent) return;
		chat.terminalSent = true;
		this.#server.send(frame);
	}

	/** True while a chat turn is in flight (streaming or an active request). Used by
	 * the worker's SIGTERM drain to let a running turn finish before teardown (#1874). */
	get busy(): boolean {
		return this.#activeChats.size > 0 || this.#session.isStreaming;
	}

	dispose(): void {
		this.#pendingRequest = null; // abandon any queued prompt — don't replay into a dead session
		// Fail any in-flight host-tool call — the session is going away.
		this.#hostToolBridge.rejectAllPending("bridge disconnected before host tool completed");
		for (const chat of this.#activeChats.values()) {
			this.#sendTerminal(chat, {
				type: "chat_error",
				id: chat.id,
				error: "session disposed",
				reason: "session-disposed",
			});
			chat.unsubscribe();
		}
		this.#activeChats.clear();
	}
}

/** SSRF guard for the `configure` frame's optional gateway `baseUrl`: the URL must
 * parse and use `https:`. Returns the ORIGINAL string unchanged on success (no
 * normalization — the operator's exact gateway path is preserved); throws (→ becomes
 * a `configure_error` nack) for a malformed or non-https URL. Loopback/private hosts
 * are intentionally NOT blocked — the target is an operator-chosen internal gateway. */
export function requireHttpsUrl(raw: string): string {
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new Error(`configure baseUrl is not a valid URL: ${raw}`);
	}
	if (parsed.protocol !== "https:") {
		throw new Error(`configure baseUrl must use https (got "${parsed.protocol}")`);
	}
	return raw;
}

/** Best-effort classification of an upstream/provider error message into a
 * ChatErrorReason so the panel can pick a distinct, actionable message. Returns
 * undefined for an unclassified error (the panel then shows the raw error text).
 * Token checks run before the generic 4xx check (a 401 is more useful as an
 * expired-token hint than a bare client error). */
export function classifyChatErrorReason(message: string): ChatErrorReason | undefined {
	const m = message.toLowerCase();
	if (/\btoken\b[^.]*\b(expir|invalid)|\b(expir|invalid)[^.]*\btoken\b|aws sso|\/context (create|validate)/.test(m)) {
		return "token-expired";
	}
	if (
		/\b5\d\d\b|internal server error|bad gateway|service unavailable|gateway timeout|econnreset|etimedout|socket hang up|network error/.test(
			m,
		)
	) {
		return "provider-5xx";
	}
	if (/\b4\d\d\b|forbidden|unauthorized|invalid model|bad request|not found|too many requests|rate limit/.test(m)) {
		return "provider-4xx";
	}
	return undefined;
}

/**
 * Chrome-extension self-awareness prompt. Injected when xcsh is serving a browser
 * chat (not the CLI TUI). Tells the LLM it's in a Chrome side panel alongside the
 * F5 XC console, what tools it has, and how to behave differently from the CLI.
 */
const CHROME_CHAT_SYSTEM_PROMPT = `[System: You are xcsh, an AI assistant for the F5 Distributed Cloud console, running as a Chrome browser side panel — not a terminal CLI.

CRITICAL: ALWAYS respond with TEXT FIRST. Do NOT jump straight to tool calls. The user sees a chat panel and expects a conversational text response, not silence while tools run in the background. For questions ("what page am I on?", "what is this?"), answer with text using the page context below — no tools needed. Only use tools when the user explicitly asks you to DO something (create, navigate, click, modify).

CONTEXT: The user sees a small chat window alongside the F5 XC admin console. You receive page-aware context each turn: the current URL (interpreted as workspace/resource/CRUD operation/namespace), the API resource JSON, and the accessibility tree. USE THIS CONTEXT to answer questions — don't call tools to find information you already have.

BEHAVIOR:
- Respond concisely with markdown. The chat panel is narrow — avoid long code blocks.
- You KNOW which page the user is on (injected below). Don't ask "what page are you on?" — tell them.
- For questions about the page/resource: answer from the injected context. No tools.
- If a blocking popup/survey appears, dismiss it by clicking the close button.
- If on the LOGIN page: use the login tool to log in. The login tool handles ALL environments — production (*.console.ves.volterra.io) AND staging (*.staging.volterra.us, login-staging.volterra.us). Do NOT claim the login tool is broken, unsupported, or doesn't work for staging — it does.

BROWSER AUTOMATION (when the user asks to create/modify/navigate resources):
- You are IN a Chrome browser. The active console tab is your workspace — use IT.
- For create/modify/delete: call catalog_workflow_runner IMMEDIATELY with ONE tool call per resource:
  {"resource": "health-check", "operation": "create", "params": {"name": "foo", "namespace": "demo"}, "presentation": "guided"}
  Do NOT read API specs first, do NOT create todos, do NOT orchestrate multi-step tool chains. The catalog_workflow_runner handles ALL the form navigation internally.
- Say a brief text message BEFORE the tool call: "Creating health check **foo** — watch the browser." Then call the tool. Nothing else.
- The human is WATCHING the form automation (fingerprint-before-click, highlights, ~1.5s/step). Do NOT use background API calls.
- The browser may be at 85% zoom — automation handles coordinates at any zoom.
- The console catalog has workflows for 100+ F5 XC resources.
- Do NOT open new tabs — drive the existing console tab.

MULTI-RESOURCE REQUESTS (when the user asks to create several resources in one prompt):
- Create resources in DEPENDENCY ORDER: health checks first, then origin pools (which reference health checks), then load balancers (which reference origin pools and app firewalls).
- After each catalog_workflow_runner call completes, IMMEDIATELY proceed to the next resource. Do NOT inspect, verify, click into, or navigate to the resource you just created. Do NOT open the JSON view. Do NOT read the page to confirm — the tool already confirmed success. Move directly to the next creation.
- Between resources, say ONE short line: "Health check created. Now creating origin pool **bar** — watch the browser." Then call the next tool.
- NEVER navigate to a list/detail/JSON view between creations. Stay on the automation path.

SAFETY — NEVER DO THESE:
- NEVER kill, stop, or manage processes on port 19222 — that is YOUR OWN bridge. Killing it kills you.
- NEVER run lsof, fuser, kill, or pkill on the bridge port. You ARE the bridge.
- NEVER use bash/shell tools to manage xcsh processes, ports, or the debugger connection.
- NEVER run commands that would terminate your own process or the WebSocket server.]

`;

const MODE_INSTRUCTIONS: Record<InteractionMode, string> = {
	educational: "Explain concepts and settings in depth. Help the user understand what they're looking at and why.",
	presentation: "Guide a structured walkthrough. Narrate each step clearly for a live audience.",
	configuration: "Help the user build or modify F5 XC configuration. Be precise and action-oriented.",
	screenshot: "Focus on capturing annotated screenshots that document the current state.",
	annotation: "Create on-page teaching annotations that highlight key elements and explain their purpose.",
};

export function composeChatPrompt(text: string, context: PageContextSnapshot | null, mode: InteractionMode): string {
	const parts: string[] = [];

	// Chrome-extension self-awareness: establishes the agent's browser context.
	parts.push(CHROME_CHAT_SYSTEM_PROMPT);
	parts.push(`[Chat mode: ${mode}] ${MODE_INSTRUCTIONS[mode]}`);

	if (context) {
		// Interpret the raw URL into structured page state (workspace, resource,
		// CRUD operation, namespace) using deterministic route-pattern matching
		// against console_ui.yaml — the LLM sees "origin_pool LIST in demo" not a
		// raw URL it must guess about.
		const pageState = interpretPageState(context.url, null, CONSOLE_ROUTES);

		parts.push("");
		parts.push(`[Page context — captured at ${new Date(context.capturedAt).toISOString()}]`);

		// Tenant + environment (the LLM knows WHICH tenant on WHICH environment).
		if (pageState.tenant || pageState.environment) {
			parts.push(`Tenant: ${pageState.tenant ?? "unknown"} (${pageState.environment ?? "unknown"} environment)`);
		}

		// Structured page state (the interpreted context the LLM acts on).
		if (pageState.operation === "login") {
			parts.push("Page: LOGIN — session expired or first login. The user is on the Keycloak authentication page.");
			parts.push(
				"Use the login tool with their email and password to log in. The login tool handles both production and staging Keycloak (including login-staging.volterra.us). Do NOT bypass it or claim it doesn't support staging.",
			);
		} else if (pageState.resource) {
			const opLabel = pageState.operation.toUpperCase();
			const nsLabel = pageState.namespace ? ` in namespace "${pageState.namespace}"` : "";
			const nameLabel = pageState.resourceName ? ` — instance "${pageState.resourceName}"` : "";
			parts.push(`Page: ${pageState.resource} ${opLabel}${nameLabel} (workspace: ${pageState.workspace}${nsLabel})`);
		} else {
			parts.push(`Page: ${context.title} (unrecognized resource)`);
		}
		if (pageState.modalBlocking) {
			parts.push(`⚠ Modal blocking: ${pageState.modalText ?? "unknown overlay"}`);
		}
		parts.push(`URL: ${context.url}`);
		parts.push(`Title: ${context.title}`);

		if (context.api) {
			parts.push(
				`API resource (${context.api.resourceType ?? "unknown"}, status ${context.api.status}): ${context.api.url}`,
			);
			if (context.api.body) {
				const body =
					typeof context.api.body === "string" ? context.api.body : JSON.stringify(context.api.body, null, 2);
				parts.push(body);
			}
			if (context.api.truncated) {
				parts.push("[API body was truncated]");
			}
		}

		if (context.ax) {
			const ax = typeof context.ax === "string" ? context.ax : JSON.stringify(context.ax);
			parts.push(`Accessibility tree: ${ax}`);
		}

		if (context.truncated) {
			parts.push("[Page context was truncated]");
		}

		parts.push("---");
	}

	parts.push("");
	parts.push(text);
	return parts.join("\n");
}

export function classifyReferenceKind(url: string): "doc" | "console" {
	try {
		const parsed = new URL(url);
		if (/\.console\.ves\.volterra\.io$/.test(parsed.hostname)) return "console";
		if (parsed.hostname === "docs.cloud.f5.com" || parsed.pathname.startsWith("/docs")) return "doc";
	} catch {
		/* malformed URL — default to doc */
	}
	return "doc";
}

function titleFromUrl(url: string): string {
	try {
		const parsed = new URL(url);
		const segments = parsed.pathname.split("/").filter(Boolean);
		return segments.length > 0 ? segments[segments.length - 1] : parsed.hostname;
	} catch {
		return url;
	}
}

function extractReferences(msg: AssistantMessage): ChatReference[] {
	const refs: ChatReference[] = [];
	const seen = new Set<string>();

	for (const block of msg.content) {
		if (block.type !== "text") continue;

		const mdLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
		for (let match = mdLinkRegex.exec(block.text); match !== null; match = mdLinkRegex.exec(block.text)) {
			const [, title, url] = match;
			if (seen.has(url)) continue;
			seen.add(url);
			refs.push({ kind: classifyReferenceKind(url), title, url });
		}

		const bareUrlRegex = /(?<!\()(https?:\/\/[^\s)>\]]+)/g;
		for (let match = bareUrlRegex.exec(block.text); match !== null; match = bareUrlRegex.exec(block.text)) {
			const url = match[1];
			if (seen.has(url)) continue;
			seen.add(url);
			refs.push({ kind: classifyReferenceKind(url), title: titleFromUrl(url), url });
		}
	}
	return refs;
}
