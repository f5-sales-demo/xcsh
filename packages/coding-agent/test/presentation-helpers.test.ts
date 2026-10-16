import { beforeAll, expect, test } from "bun:test";
import type { PluginPresentation } from "@f5-sales-demo/pi-agent-core";
import { type TUI, visibleWidth } from "@f5-sales-demo/pi-tui";
import { Type } from "@sinclair/typebox";
import { ExtensionRuntime, loadExtensionFromFactory } from "../src/extensibility/extensions/loader";
import type { ExtensionRunner } from "../src/extensibility/extensions/runner";
import type { ExtensionAPI } from "../src/extensibility/extensions/types";
import { wrapRegisteredTool } from "../src/extensibility/extensions/wrapper";
import { CustomMessageComponent } from "../src/modes/components/custom-message";
import { ToolExecutionComponent } from "../src/modes/components/tool-execution";
import { initTheme, setTheme } from "../src/modes/theme/theme";
import { convertToLlm } from "../src/session/messages";
import { SessionManager } from "../src/session/session-manager";
import { EventBus } from "../src/utils/event-bus";

let presentation: ExtensionAPI["presentation"];
beforeAll(async () => {
	await initTheme();
	await loadExtensionFromFactory(
		pi => {
			presentation = pi.presentation;
		},
		process.cwd(),
		new EventBus(),
		new ExtensionRuntime(),
	);
});
test("runtime injects one reusable data-only presentation API", () => {
	expect(presentation).toBeDefined();
	expect(Object.isFrozen(presentation)).toBe(true);
	expect(presentation.fields({ count: 0, enabled: false, missing: null }).values).toEqual({
		count: 0,
		enabled: false,
		missing: null,
	});
	expect(presentation.data([])).toEqual([{ kind: "fields", values: { count: 0 } }]);
	expect(presentation.data({})).toEqual([{ kind: "code", text: "{}" }]);
});
test("command helper preserves quoting, empty argv, Unicode and newlines without execution", () => {
	expect(presentation.command(["sf", "", "literal's value", "北方\nline"])).toEqual({
		kind: "code",
		text: "sf '' 'literal'\\''s value' '北方\nline'",
	});
});
test("table labels, order and explicit number formatting preserve source rows", () => {
	const rows = [{ id: "synthetic-1", amount: 0, currency: "CAD", enabled: false }];
	const copy = structuredClone(rows);
	const view = presentation.table(rows, [
		{ key: "amount", label: "Amount", numberFormat: { minimumFractionDigits: 2 } },
		{ key: "currency", label: "Currency" },
	]);
	expect(view.columns.map(c => c.label)).toEqual(["Amount", "Currency"]);
	expect(view.columns[0]?.align).toBe("right");
	expect(view.rows[0]?.amount).toBe("0.00");
	expect(rows).toEqual(copy);
});
test("shared descriptors use structured details and preserve domain and streaming warnings", () => {
	const tool = presentation.withPresentation({ name: "synthetic_list", label: "Synthetic list" });
	const payload = {
		content: [{ type: "text", text: "model-facing summary" }],
		details: { records: [{ id: "synthetic-last", total: 0 }], done: false },
	};
	const copy = structuredClone(payload);
	const view = tool.presentation.result!(payload, { expanded: false, isPartial: true }, {});
	expect(JSON.stringify(view)).toContain("synthetic-last");
	expect(view?.warnings?.join(" ")).toContain("incomplete");
	expect(view?.warnings?.join(" ")).toContain("streaming");
	expect(payload).toEqual(copy);
	const domain: PluginPresentation = {
		result: () => ({ summary: "Domain evidence", warnings: ["Currency unverified"] }),
	};
	expect(
		presentation.withPresentation({ name: "domain" }, domain).presentation.result!(
			payload,
			{ expanded: false, isPartial: true },
			{},
		)?.warnings,
	).toContain("Currency unverified");
});
test("failed or empty domain callbacks retain diagnostic text and media", () => {
	const tool = presentation.withPresentation(
		{ name: "synthetic_error" },
		{
			result: () => {
				throw new Error("fixture");
			},
		},
	);
	const view = tool.presentation.result!(
		{
			content: [{ type: "text", text: "Actual unavailable host; retry after setup" }],
			details: { errorType: "host_unavailable" },
			isError: true,
		},
		{ expanded: true, isPartial: false },
		{},
	);
	expect(JSON.stringify(view)).toContain("Actual unavailable host");
	const media = tool.presentation.result!(
		{ content: [{ type: "image", mimeType: "image/png" }] },
		{ expanded: false, isPartial: false },
		{},
	);
	expect(JSON.stringify(media)).toContain("image/png");
});
test("shared helpers render complete data through registered production tools", async () => {
	const rows = Array.from({ length: 40 }, (_, i) => ({
		id: `synthetic-${i}`,
		count: 0,
		enabled: false,
		missing: null,
		note: "北方\nline two",
	}));
	const extension = await loadExtensionFromFactory(
		pi => {
			pi.registerTool(
				pi.presentation.withPresentation({
					name: "synthetic_registered",
					label: "Synthetic registered",
					description: "Synthetic",
					parameters: Type.Object({}),
					async execute() {
						return {
							content: [{ type: "text" as const, text: "model payload" }],
							details: { rows, done: false },
						};
					},
				}),
			);
		},
		process.cwd(),
		new EventBus(),
		new ExtensionRuntime(),
	);
	const registered = extension!.tools.get("synthetic_registered")!;
	const tool = wrapRegisteredTool(registered, { createContext: () => ({}) } as ExtensionRunner);
	const c = new ToolExecutionComponent(tool.name, {}, {}, tool, { requestRender() {} } as TUI);
	c.updateResult(await tool.execute("synthetic", {}, undefined));
	for (const name of ["xcsh-dark", "xcsh-light"]) {
		await setTheme(name);
		for (const width of [40, 76, 120, 153]) {
			c.setExpanded(false);
			expect(c.render(width).every(l => visibleWidth(l) <= width)).toBe(true);
			expect(c.render(width).join("\n")).toContain("incomplete");
			c.setExpanded(true);
			expect(c.render(width).every(l => visibleWidth(l) <= width)).toBe(true);
			expect(c.render(width).join("\n")).toContain("synthetic-39");
		}
	}
});
test("custom message presentation remains separate from model-facing content", () => {
	const message = {
		role: "custom" as const,
		customType: "synthetic",
		content: "model content",
		display: true,
		timestamp: 0,
		presentation: { summary: "Verified count = 0", sections: [presentation.fields({ enabled: false })] },
	};
	const c = new CustomMessageComponent(message);
	expect(c.render(40).join("\n")).toContain("Verified count = 0");
	expect(message.content).toBe("model content");
});
test("declarative profiles enrich nested collections and retain text with primitive metadata", () => {
	const tool = presentation.withPresentation(
		{ name: "synthetic_inventory", label: "Inventory" },
		{
			collections: ["instances"],
			labels: { id: "Instance ID" },
			scopeKeys: ["region"],
			scopeNote: "Returned evidence only",
		},
	);
	const result = {
		content: [{ type: "text", text: "Detailed CLI guidance" }],
		details: { region: "synthetic-region" },
	};
	expect(JSON.stringify(tool.presentation.result!(result, { expanded: false, isPartial: false }, {}))).toContain(
		"Detailed CLI guidance",
	);
	const nested = tool.presentation.result!(
		{ content: [], details: { observation: { instances: [{ id: "synthetic-1", enabled: false }] } } },
		{ expanded: false, isPartial: false },
		{ region: "synthetic-region" },
	);
	expect(nested?.summary).toContain("1 instances returned");
	expect(JSON.stringify(nested)).toContain("Instance ID");
	expect(JSON.stringify(nested)).toContain("Returned evidence only");
});
test("empty descriptor sections and custom message views retain execution evidence", () => {
	const tool = presentation.withPresentation({ name: "empty" }, { result: () => ({ sections: [] }) });
	expect(
		JSON.stringify(
			tool.presentation.result!(
				{ content: [{ type: "text", text: "Evidence must survive" }] },
				{ expanded: true, isPartial: false },
				{},
			),
		),
	).toContain("Evidence must survive");
	const component = new CustomMessageComponent({
		role: "custom",
		customType: "empty",
		content: "Message evidence survives",
		display: true,
		timestamp: 0,
		presentation: { sections: [] },
	});
	expect(component.render(40).join("\n")).toContain("Message evidence survives");
});

test("custom presentation survives stored session reconstruction without entering model content", () => {
	const manager = SessionManager.inMemory();
	const view = { summary: "UI synthetic count = 0", sections: [] };
	manager.appendCustomMessageEntry("fixture", "Model evidence", true, undefined, "agent", 0, view);
	const context = manager.buildSessionContext();
	expect((context.messages[0] as { presentation?: unknown }).presentation).toEqual(view);
	expect(JSON.stringify(convertToLlm(context.messages))).not.toContain("UI synthetic count");
	expect(JSON.stringify(convertToLlm(context.messages))).toContain("Model evidence");
});

test("nested execution metadata retains useful CLI text", () => {
	const tool = presentation.withPresentation({ name: "metadata_command" });
	const payload = {
		content: [{ type: "text", text: "Synthetic command returned zero eligible records" }],
		details: { meta: { durationMs: 12 }, scope: { region: "synthetic-region" } },
	};
	const view = tool.presentation.result(payload, { expanded: true, isPartial: false }, {});
	expect(JSON.stringify(view)).toContain("zero eligible records");
	expect(JSON.stringify(view)).toContain("durationMs");
});

test("error fallback keeps structured diagnostic details beside guidance", () => {
	const tool = presentation.withPresentation({ name: "synthetic_failure" });
	const view = tool.presentation.result(
		{
			content: [{ type: "text", text: "Retry after setup" }],
			isError: true,
			details: { failure: { reason: "synthetic unavailable contract", code: 0 } },
		},
		{ expanded: true, isPartial: false },
		{},
	);
	expect(JSON.stringify(view)).toContain("Retry after setup");
	expect(JSON.stringify(view)).toContain("synthetic unavailable contract");
});

test("declarative profiles preserve structured warning reasons", () => {
	const tool = presentation.withPresentation({ name: "synthetic_status" }, { collections: ["items"] });
	const view = tool.presentation.result(
		{
			content: [],
			details: { items: [], unavailable: [{ reason: "synthetic telemetry unavailable", category: "contract" }] },
		},
		{ expanded: false, isPartial: false },
		{},
	);
	expect(view.warnings?.join(" ")).toContain("synthetic telemetry unavailable");
});

test("wrapping a class tool preserves prototype execution and private state", async () => {
	class ClassTool {
		name = "class_tool";
		#value = "synthetic private execution";
		async execute() {
			return { content: [{ type: "text", text: this.#value }] };
		}
	}
	const original = Object.freeze(new ClassTool());
	const wrapped = presentation.withPresentation(original);
	expect(await wrapped.execute()).toEqual(await original.execute());
	expect("presentation" in original).toBe(false);
});
