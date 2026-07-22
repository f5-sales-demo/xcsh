/**
 * Agent tools for the Chrome extension's browser actions.
 *
 * The extension advertises a fixed set of tools (EXTENSION_CAPABILITIES.tools:
 * navigate, click, read_ax, type_text, …). Before this factory, those names were
 * requested by the worker (BROWSER_TOOL_NAMES) but never registered as agent
 * tools — so the agent could only run the form-driven `catalog_workflow_runner`
 * and had no way to `navigate`/`click`, i.e. it replied "Navigating…" and never
 * drove the browser. This turns each advertised tool into a `CustomTool` whose
 * `execute` proxies the call to the connected extension over the bridge.
 */
import type { AgentToolResult, AgentToolUpdateCallback } from "@f5-sales-demo/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import type { CustomTool, CustomToolContext } from "../extensibility/custom-tools/types";
import { EXTENSION_CAPABILITIES, type ExtensionToolDef } from "./capabilities.generated";
import type { BridgeServer } from "./extension-bridge";

/**
 * Extension tools that are transport/diagnostic plumbing, not agent actions —
 * never exposed to the LLM. Everything else in EXTENSION_CAPABILITIES becomes a
 * callable agent tool.
 */
const INTERNAL_TOOLS = new Set<string>([
	"ping",
	"capabilities",
	"reload",
	"debug_exec",
	"detach",
	"set_bridge_port",
	"diag_suspension",
	"diag_bridges",
]);

/** Build a CustomTool that proxies one extension tool to `bridge.request`. */
function bridgeTool(bridge: BridgeServer, def: ExtensionToolDef): CustomTool<TSchema, unknown> {
	return {
		name: def.name,
		label: def.name,
		description: def.summary,
		// The extension's JSON-Schema `params` is a TypeBox-compatible schema object.
		parameters: (def.params ?? { type: "object", properties: {} }) as unknown as TSchema,
		async execute(
			_toolCallId: string,
			params: unknown,
			_onUpdate: AgentToolUpdateCallback<unknown, TSchema> | undefined,
			_ctx: CustomToolContext,
			_signal?: AbortSignal,
		): Promise<AgentToolResult<unknown, TSchema>> {
			const res = await bridge.request(def.name, (params ?? {}) as Record<string, unknown>);
			const raw = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
			// AgentToolResult has no isError flag — surface the extension's error in the
			// text so the model sees the failure and can react.
			const text = res.is_error ? `Error: ${raw}` : raw;
			return { content: [{ type: "text" as const, text }] };
		},
	};
}

/**
 * Every agent-facing extension tool as a bridge-proxying CustomTool. Pass the
 * result to `createAgentSession({ customTools })` so the worker's agent can drive
 * the browser. Requires `bridge` (the worker's live extension-bridge server).
 */
export function createExtensionBridgeTools(bridge: BridgeServer): CustomTool<TSchema, unknown>[] {
	return EXTENSION_CAPABILITIES.tools.filter(def => !INTERNAL_TOOLS.has(def.name)).map(def => bridgeTool(bridge, def));
}

/** Names of the agent-facing extension tools (for tool-scoping / tests). */
export const EXTENSION_AGENT_TOOL_NAMES: readonly string[] = EXTENSION_CAPABILITIES.tools
	.filter(def => !INTERNAL_TOOLS.has(def.name))
	.map(def => def.name);

/**
 * Builtin agent tools scoped into a headless browser-bridge session (the Chrome
 * extension worker and the Office `serve` bridge). Shared so both bootstraps use
 * one list. Office document tools are NOT here — the pane advertises those over
 * the bridge via `set_host_tools`, registered at runtime by the ChatHandler.
 */
export const BROWSER_TOOL_NAMES: readonly string[] = [
	"catalog_workflow_runner",
	"navigate",
	"click",
	"click_element",
	"fill",
	"type_text",
	"screenshot",
	"login",
	"read_ax",
	"get_page_context",
	"query_dom",
	"find",
	"wait_for",
	"key_press",
	"select_option",
	"label_select",
	"scroll_to",
	"annotate",
	"set_explain_mode",
];
