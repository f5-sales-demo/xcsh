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

/**
 * Builtin agent tools scoped into the headless OFFICE bridge (`xcsh office serve`).
 *
 * FULL CLI-PARITY tool set (minus browser automation): the Office pane is a full
 * local xcsh agent, so it gets the same general-purpose native tools the CLI has —
 * `bash` (so it can shell out to `az`, `gh`, terraform, git, …), the file tools
 * (`read`/`write`/`edit`), search (`grep`), plus planning (`todo_write`,
 * `task`) and `calc`. (File-finding is covered by `bash`; the builtin `find`
 * tool is omitted because its name collides with a browser tool.) The document's own Excel/PowerPoint/Word tools arrive at
 * runtime over the bridge via `set_host_tools`.
 *
 * DELIBERATELY EXCLUDED:
 *  - Every {@link BROWSER_TOOL_NAMES} entry — there is no browser to drive in a
 *    document pane, so navigate/click/screenshot would only be hallucinated.
 *  - `ask` (needs interactive stdin → would hang headless), `python` (spawns a
 *    kernel → startup cost), `ssh`/`debug`/`notebook`/`browser`/`get_page_context`.
 *
 * SAFETY: the headless session pairs this with the bundled `sandbox-guard`
 * extension (see headless-bridge.ts `bundledExtensions`), which confines the file
 * tools + the shell's working dir to the launch cwd subtree — the CLI's own model.
 * `az`/`gh` still run (network actions aren't filesystem-confined); credentials must
 * already exist for the process user. There is no per-tool approval prompt — the
 * local trusted bridge auto-runs tools exactly as the CLI does.
 *
 * THREAT MODEL (reviewed + accepted, 2026-07-24): the pane's agent auto-reads
 * document content, which could be adversarial (a prompt-injected customer .xlsx)
 * and steer it into shell/`az`/`gh` calls; the filesystem sandbox blocks file
 * damage outside cwd but NOT network/cloud actions. This is the same exposure the
 * xcsh CLI already carries (no approval system anywhere). The operator explicitly
 * chose full CLI parity + FS sandbox over a bash approval gate, mitigating in
 * practice by only opening trusted documents. If untrusted files become common,
 * revisit with a per-shell approval round-trip (host_tool_call-style frame).
 *
 * NOTE: an EMPTY list cannot express "no builtin tools" — createTools treats `[]` as
 * "unscoped" and returns the FULL registry (including browser tools). So this is an
 * explicit curated array, not `[]`.
 */
export const OFFICE_TOOL_NAMES: readonly string[] = [
	"read",
	"write",
	"edit",
	"bash",
	"grep",
	"todo_write",
	"task",
	"calc",
];
