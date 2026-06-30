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
import type { BridgeServer } from "./extension-bridge";

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

const MODE_INSTRUCTIONS: Record<InteractionMode, string> = {
	educational: "Explain concepts and settings in depth. Help the user understand what they're looking at and why.",
	presentation: "Guide a structured walkthrough. Narrate each step clearly for a live audience.",
	configuration: "Help the user build or modify F5 XC configuration. Be precise and action-oriented.",
	screenshot: "Focus on capturing annotated screenshots that document the current state.",
	annotation: "Create on-page teaching annotations that highlight key elements and explain their purpose.",
};

export function composeChatPrompt(text: string, context: PageContextSnapshot | null, mode: InteractionMode): string {
	const parts: string[] = [];

	parts.push(`[Chat mode: ${mode}] ${MODE_INSTRUCTIONS[mode]}`);

	if (context) {
		parts.push("");
		parts.push(`[Page context — captured at ${new Date(context.capturedAt).toISOString()}]`);
		parts.push(`URL: ${context.url}`);
		parts.push(`Title: ${context.title}`);

		if (context.api) {
			parts.push(`API resource (${context.api.resourceType}, status ${context.api.status}): ${context.api.url}`);
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

function extractReferences(msg: AssistantMessage): ChatReference[] {
	const refs: ChatReference[] = [];
	for (const block of msg.content) {
		if (block.type !== "text") continue;
		const urlRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
		for (let match = urlRegex.exec(block.text); match !== null; match = urlRegex.exec(block.text)) {
			const [, title, url] = match;
			const kind = url.includes("docs.cloud.f5.com") || url.includes("docs.") ? "doc" : "console";
			refs.push({ kind, title, url });
		}
	}
	return refs;
}
