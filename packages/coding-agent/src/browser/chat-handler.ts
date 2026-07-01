import type { AssistantMessage } from "@f5-sales-demo/pi-ai";
import type { AgentSession, AgentSessionEvent } from "../session/agent-session";
import {
	type ChatDelta,
	type ChatDone,
	type ChatError,
	type ChatReference,
	type ChatRequest,
	type InteractionMode,
	isChatRequest,
	isChatStop,
	type PageContextSnapshot,
} from "./chat-protocol";
import { CONSOLE_ROUTES } from "./console-routes.generated";
import type { BridgeServer } from "./extension-bridge";
import { interpretPageState } from "./page-state-interpreter";

interface ActiveChat {
	id: string;
	seq: number;
	terminalSent: boolean;
	unsubscribe: () => void;
}

export class ChatHandler {
	#server: BridgeServer;
	#session: AgentSession;
	#activeChats = new Map<string, ActiveChat>();
	#activeHistoryHint: string | undefined;

	constructor(server: BridgeServer, session: AgentSession) {
		this.#server = server;
		this.#session = session;
	}

	attach(): void {
		this.#server.onMessage(msg => {
			if (isChatRequest(msg)) this.#handleChatRequest(msg as unknown as ChatRequest);
			else if (isChatStop(msg)) this.#handleChatStop(msg as unknown as { id: string });
		});

		this.#server.onDisconnected(() => {
			for (const chat of this.#activeChats.values()) {
				this.#sendTerminal(chat, { type: "chat_error", id: chat.id, error: "bridge disconnected" });
				chat.unsubscribe();
			}
			this.#activeChats.clear();
		});
	}

	async #handleChatRequest(req: ChatRequest): Promise<void> {
		const { id } = req;

		if (this.#session.isStreaming || this.#activeChats.size > 0) {
			this.#server.send({ type: "chat_error", id, error: "session busy" } satisfies ChatError);
			return;
		}

		if (req.history_hint && req.history_hint !== this.#activeHistoryHint) {
			this.#session.agent.replaceMessages([]);
			this.#activeHistoryHint = req.history_hint;
		}

		const chat: ActiveChat = { id, seq: 0, terminalSent: false, unsubscribe: () => {} };
		this.#activeChats.set(id, chat);

		const unsubscribe = this.#session.subscribe((event: AgentSessionEvent) => {
			this.#handleSessionEvent(chat, event);
		});
		chat.unsubscribe = unsubscribe;

		const prompt = composeChatPrompt(req.text, req.context, req.mode);

		try {
			await this.#session.prompt(prompt, { expandPromptTemplates: false, synthetic: false });
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "unknown error";
			this.#sendTerminal(chat, { type: "chat_error", id, error: message });
		} finally {
			if (!chat.terminalSent) {
				this.#sendTerminal(chat, { type: "chat_done", id });
			}
			chat.unsubscribe();
			this.#activeChats.delete(id);
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
			} else if (ame.type === "error") {
				const errorMsg = ame.error?.errorMessage ?? "LLM error";
				this.#sendTerminal(chat, { type: "chat_error", id: chat.id, error: errorMsg });
			}
		} else if (event.type === "message_end" && event.message.role === "assistant") {
			const msg = event.message as AssistantMessage;
			if (msg.stopReason === "error") {
				this.#sendTerminal(chat, {
					type: "chat_error",
					id: chat.id,
					error: msg.errorMessage ?? "assistant error",
				});
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

	dispose(): void {
		for (const chat of this.#activeChats.values()) {
			this.#sendTerminal(chat, { type: "chat_error", id: chat.id, error: "session disposed" });
			chat.unsubscribe();
		}
		this.#activeChats.clear();
	}
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
- If on the LOGIN page: offer to help log in.

BROWSER AUTOMATION (when the user asks to create/modify/navigate resources):
- You are IN a Chrome browser. The active console tab is your workspace — use IT.
- ALWAYS use catalog_workflow_runner to drive the REAL FORM visually. Do NOT use API calls, do NOT "grab the API spec" — the human is WATCHING the browser and wants to SEE the form automation happen (navigate → click "Add" → fill fields → save).
- Use presentation profile "guided" for human-observable automation: fingerprint-before-click overlays, highlight cues, paced at ~1.5s per step so the user can follow.
- The browser may be at 85% zoom — elements are smaller but more content is visible. The automation tools handle coordinates correctly at any zoom level.
- Stream brief progress text as you go: "Navigating to Health Checks…", "Filling the Name field…", "Saving…" — so the chat panel shows what's happening.
- The console catalog (xcsh://console/) has workflows for 100+ F5 XC resources. Use catalog_workflow_runner with the resource name and operation.
- Do NOT open new tabs — drive the existing console tab.

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
				"You can help by using the login tool with their email and password, or guide them to log in manually.",
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
