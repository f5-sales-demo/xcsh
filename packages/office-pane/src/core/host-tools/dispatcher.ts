/**
 * Client-side host-tool dispatcher.
 *
 * The mirror image of the xcsh agent-side `RpcHostToolBridge`: the client
 * ADVERTISES the tools it can run (`set_host_tools`), then the agent drives them
 * — the client RECEIVES `host_tool_call` / `host_tool_cancel` (inbound) and
 * REPLIES with `host_tool_result` (outbound). A reply is always an
 * {@link AgentToolResult} — a `content[]` array, NEVER `{ data }`.
 *
 * The load-bearing invariant: **every `host_tool_call` is answered exactly once**
 * — success, thrown error, or unknown tool all produce a `host_tool_result`, or
 * the agent turn hangs waiting on the call. The sole exception is a call the
 * agent itself cancels: an aborted call must NOT emit a stale result.
 */
import { type AgentToolResult, type HostToolDefinition, isHostToolCall, isHostToolCancel } from "../protocol";
import type { ChatInbound, Transport } from "../transport";

/** Execution context handed to a host-tool handler. */
export interface HostToolContext {
	/** Aborts when the agent sends `host_tool_cancel` for this call. */
	readonly signal: AbortSignal;
	/** The agent-side tool-call id (for correlation/telemetry). */
	readonly toolCallId: string;
	/** The host-tool call id this result correlates to. */
	readonly callId: string;
}

/** A handler that executes a host tool and returns its result. */
export type HostToolHandler = (
	args: Record<string, unknown>,
	ctx: HostToolContext,
) => Promise<AgentToolResult> | AgentToolResult;

/** A tool the client advertises plus the handler that runs it. */
export interface HostToolRegistration {
	definition: HostToolDefinition;
	handler: HostToolHandler;
}

function errorResult(message: string): AgentToolResult {
	return { content: [{ type: "text", text: message }] };
}

export class HostToolDispatcher {
	private readonly handlers = new Map<string, HostToolHandler>();
	private readonly pending = new Map<string, AbortController>();
	private unsubscribe: (() => void) | null;

	constructor(private readonly transport: Transport) {
		this.unsubscribe = transport.onMessage(m => this.handleInbound(m));
	}

	/** Number of in-flight host-tool calls (exposed for tests/observability). */
	get pendingCount(): number {
		return this.pending.size;
	}

	/**
	 * Replace the advertised tool set and push it to the agent via
	 * `set_host_tools`. Advertising an empty list clears the client's tools.
	 */
	register(tools: HostToolRegistration[]): void {
		this.handlers.clear();
		for (const t of tools) {
			this.handlers.set(t.definition.name, t.handler);
		}
		this.transport.send({ type: "set_host_tools", tools: tools.map(t => t.definition) });
	}

	/** Unsubscribe, abort every pending call, and drop all handlers. */
	dispose(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		for (const ctrl of this.pending.values()) ctrl.abort();
		this.pending.clear();
		this.handlers.clear();
	}

	private handleInbound(msg: ChatInbound): void {
		if (isHostToolCall(msg)) {
			void this.runCall(msg.id, msg.toolCallId, msg.toolName, msg.arguments);
		} else if (isHostToolCancel(msg)) {
			this.cancel(msg.targetId);
		}
	}

	private async runCall(
		id: string,
		toolCallId: string,
		toolName: string,
		args: Record<string, unknown>,
	): Promise<void> {
		const handler = this.handlers.get(toolName);
		if (!handler) {
			// Unknown tool — answer immediately so the agent never hangs.
			this.transport.send({
				type: "host_tool_result",
				id,
				result: errorResult(`Unknown host tool: ${toolName}`),
				isError: true,
			});
			return;
		}

		// Relies on the agent generating a unique `id` per call (the xcsh
		// rpc-client contract). A repeated id would overwrite the prior
		// controller here and could strand the earlier call unanswered.
		const controller = new AbortController();
		this.pending.set(id, controller);

		try {
			const result = await handler(args, { signal: controller.signal, toolCallId, callId: id });
			// A cancel deletes the pending entry; a still-present entry means live.
			if (this.pending.delete(id)) {
				this.transport.send({ type: "host_tool_result", id, result });
			}
		} catch (err) {
			if (this.pending.delete(id)) {
				const message = err instanceof Error ? err.message : String(err);
				this.transport.send({ type: "host_tool_result", id, result: errorResult(message), isError: true });
			}
		}
	}

	private cancel(targetId: string): void {
		const controller = this.pending.get(targetId);
		if (!controller) return;
		// Drop first so the resolving handler's continuation sees no pending entry
		// and suppresses its (now stale) result.
		this.pending.delete(targetId);
		controller.abort();
	}
}
