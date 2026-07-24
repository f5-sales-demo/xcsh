/**
 * Guard for the extension→agent tool bridge. Regression defense for "agent
 * responds but never drives": the worker requested browser tool names
 * (navigate/click/…) that were never registered, so the agent could only run
 * catalog_workflow_runner. `createExtensionBridgeTools` turns every agent-facing
 * extension capability into a bridge-proxying CustomTool. These tests assert the
 * core actions exist, internal plumbing is excluded, and calls proxy to the
 * bridge — no LLM/Chrome required. (End-to-end is covered by the manual
 * ~/xcsh-uat/worker-tools-harness.ts, which needs a live model.)
 */
import { describe, expect, test } from "bun:test";
import type { BridgeServer } from "../src/browser/extension-bridge";
import {
	BROWSER_TOOL_NAMES,
	createExtensionBridgeTools,
	EXTENSION_AGENT_TOOL_NAMES,
	OFFICE_TOOL_NAMES,
} from "../src/browser/extension-bridge-tools";

function mockBridge(reply: { content: unknown; is_error: boolean }): BridgeServer {
	return { request: async () => reply } as unknown as BridgeServer;
}
const okBridge = mockBridge({ content: "done", is_error: false });

describe("createExtensionBridgeTools", () => {
	const tools = createExtensionBridgeTools(okBridge);
	const names = tools.map(t => t.name);

	test("registers the core browser actions as agent tools", () => {
		for (const n of ["navigate", "click", "read_ax", "type_text", "screenshot", "login", "query_dom", "scroll_to"]) {
			expect(names).toContain(n);
		}
	});

	test("excludes internal/diagnostic plumbing", () => {
		for (const n of [
			"ping",
			"capabilities",
			"set_bridge_port",
			"debug_exec",
			"detach",
			"diag_bridges",
			"diag_suspension",
		]) {
			expect(names).not.toContain(n);
		}
	});

	test("EXTENSION_AGENT_TOOL_NAMES matches the produced tool set", () => {
		expect(new Set(EXTENSION_AGENT_TOOL_NAMES)).toEqual(new Set(names));
		expect(names.length).toBeGreaterThan(15);
	});

	test("each tool proxies to bridge.request and returns the content as text", async () => {
		const nav = tools.find(t => t.name === "navigate");
		expect(nav).toBeDefined();
		const res = await nav?.execute("id", { url: "https://x" }, undefined, {} as never, undefined);
		expect((res?.content[0] as { text: string }).text).toBe("done");
	});

	test("surfaces a bridge error in the result text (no isError flag on AgentToolResult)", async () => {
		const t = createExtensionBridgeTools(mockBridge({ content: "boom", is_error: true })).find(
			x => x.name === "click",
		);
		const res = await t?.execute("id", {}, undefined, {} as never, undefined);
		expect((res?.content[0] as { text: string }).text).toContain("Error: ");
	});
});

describe("OFFICE_TOOL_NAMES (full CLI-parity tool set)", () => {
	test("includes the general native tools so the pane matches the CLI (bash/az/gh, file, search)", () => {
		for (const n of ["read", "write", "edit", "bash", "grep", "todo_write", "task", "calc"]) {
			expect(OFFICE_TOOL_NAMES).toContain(n);
		}
	});

	test("excludes every browser-automation tool (nonsensical in a document pane)", () => {
		for (const n of BROWSER_TOOL_NAMES) {
			expect(OFFICE_TOOL_NAMES).not.toContain(n);
		}
	});

	test("excludes tools that would hang headless (ask) or add kernel startup cost (python)", () => {
		expect(OFFICE_TOOL_NAMES).not.toContain("ask");
		expect(OFFICE_TOOL_NAMES).not.toContain("python");
	});

	test("is a non-empty explicit list (an empty list would unscope to the FULL registry incl. browser tools)", () => {
		expect(OFFICE_TOOL_NAMES.length).toBeGreaterThan(0);
	});
});
