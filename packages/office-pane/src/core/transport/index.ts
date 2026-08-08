/**
 * Pluggable transport seam.
 *
 * Browser-safe: no node:* imports, no Office.js, no runtime @f5-sales-demo/* deps.
 */
import type {
	ChatInboundMsg,
	ChatRequestMsg,
	ChatStopMsg,
	ConfigureMsg,
	HostToolResultMsg,
	HostToolUpdateMsg,
	ListCommandsMsg,
	ListModelsMsg,
	ListSkillsMsg,
	PickPathMsg,
	SetHostToolsMsg,
} from "../protocol";

/**
 * Messages the panel/client sends to the worker (outbound from the panel's
 * perspective). Includes the host-tool frames the client SENDS: it advertises
 * tools (`set_host_tools`) and returns their results/updates (`host_tool_result`
 * / `host_tool_update`), plus the `configure` frame that sets xcsh's provider.
 */
export type ChatOutbound =
	| ChatRequestMsg
	| ChatStopMsg
	| SetHostToolsMsg
	| HostToolResultMsg
	| HostToolUpdateMsg
	| ConfigureMsg
	| ListSkillsMsg
	| ListCommandsMsg
	| ListModelsMsg
	| PickPathMsg;

/**
 * Messages the worker sends to the panel (inbound to the panel). Includes the
 * host-tool frames the client RECEIVES (`host_tool_call` / `host_tool_cancel`),
 * carried on `ChatInboundMsg`.
 */
export type ChatInbound = ChatInboundMsg;

/**
 * Pluggable transport interface.
 *
 * - `connect()` — establish the channel; resolves when ready.
 * - `send(msg)` — send an outbound message to the worker.
 * - `onMessage(cb)` — subscribe to inbound messages; returns an unsubscribe function.
 * - `stop(id)` — send a `chat_stop` for the given turn id.
 * - `dispose()` — tear down the channel, clear subscribers, set state 'closed'.
 * - `state` — observable lifecycle state.
 */
export interface Transport {
	connect(): Promise<void>;
	send(msg: ChatOutbound): void;
	onMessage(cb: (m: ChatInbound) => void): () => void;
	stop(id: string): void;
	dispose(): void;
	readonly state: "idle" | "connecting" | "open" | "closed";
}

/** Config the pane sends to xcsh's `configure` frame (base URL + token + model). */
export interface ProviderConfigure {
	baseUrl?: string;
	token?: string;
	model?: string;
}

/**
 * A transport that can configure xcsh's LLM provider at runtime (the
 * single-engine parity path). `configure()` resolves with the selected model on
 * `configure_ack` and rejects on `configure_error`. `canConfigureProvider`
 * reflects the bridge's advertised capability (from `hello_ack`).
 */
export interface ConfigurableTransport extends Transport {
	configure(config: ProviderConfigure): Promise<string>;
	readonly canConfigureProvider: boolean;
}

export type { LoopbackBridgeOptions, WebSocketFactory } from "./loopback";
export { LoopbackBridgeTransport } from "./loopback";
export { MockTransport } from "./mock";
