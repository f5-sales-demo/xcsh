import { beforeAll, describe, expect, test } from "bun:test";
import { Text, type TUI, visibleWidth } from "@f5-sales-demo/pi-tui";
import { Type } from "@sinclair/typebox";
import { ExtensionRuntime, loadExtensionFromFactory } from "../src/extensibility/extensions/loader";
import type { ExtensionRunner } from "../src/extensibility/extensions/runner";
import { wrapRegisteredTool } from "../src/extensibility/extensions/wrapper";
import { ToolExecutionComponent } from "../src/modes/components/tool-execution";
import { initTheme, setTheme } from "../src/modes/theme/theme";
import { EventBus } from "../src/utils/event-bus";

beforeAll(async () => {
	await initTheme();
});
const plain = (lines: string[]) => lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
async function component(extra: Record<string, unknown> = {}) {
	const extension = await loadExtensionFromFactory(
		pi => {
			pi.registerTool({
				name: "fixture_plugin",
				label: "Fixture plugin",
				description: "Synthetic",
				parameters: Type.Object({}),
				async execute() {
					return { content: [{ type: "text", text: "unused" }] };
				},
				...extra,
			});
		},
		process.cwd(),
		new EventBus(),
		new ExtensionRuntime(),
	);
	const registered = extension!.tools.get("fixture_plugin")!;
	const tool = wrapRegisteredTool(registered, {} as ExtensionRunner);
	return new ToolExecutionComponent(tool.name, { query: "SELECT COUNT(Id) total" }, {}, tool, {
		requestRender() {},
	} as TUI);
}
describe("registered plugin presentation", () => {
	test("fallback exposes the hidden zero aggregate and complete rows", async () => {
		const c = await component();
		c.updateResult({
			content: [
				{ type: "text", text: JSON.stringify({ status: 0, result: { records: [{ total: 0 }], done: true } }) },
			],
		});
		expect(plain(c.render(76))).toContain("0");
		expect(plain(c.render(76))).toContain("total");
	});
	test("expanded fallback retains long errors, arguments and all 300 lines", async () => {
		const c = await component();
		c.updateArgs({ query: "DefinitelyMissingDemoField__c".repeat(10), flags: [false, null, 0] });
		c.updateResult({
			isError: true,
			content: [
				{ type: "text", text: Array.from({ length: 300 }, (_, i) => `line-${i}: corrective guidance`).join("\n") },
			],
		});
		c.setExpanded(true);
		const lines = c.render(40);
		expect(plain(lines)).toContain("line-299");
		expect(
			plain(lines)
				.replace(/[\s│|]/g, "")
				.match(/DefinitelyMissingDemoField__c/g)?.length,
		).toBe(10);
		expect(lines.every(line => visibleWidth(line) <= 40)).toBe(true);
	});
	test("descriptor is carried through registration independently of result data", async () => {
		const c = await component({
			presentation: {
				result: () => ({
					summary: "total = 0",
					sections: [{ kind: "fields", values: { valid: false, missing: null } }],
				}),
			},
		});
		c.updateResult({ content: [{ type: "text", text: "model-facing payload" }] });
		expect(plain(c.render(76))).toContain("total = 0");
		expect(plain(c.render(76))).toContain("false");
	});
	for (const renderResult of [
		() => undefined,
		() => new Text("", 0, 0),
		() => ({ render: (width: number) => [`\x1b[48;5;236m${" ".repeat(width)}\x1b[0m`], invalidate() {} }),
		() => {
			throw new Error("fixture");
		},
		() => ({
			render() {
				throw new Error("late failure");
			},
		}),
	]) {
		test("failed or empty explicit renderer preserves fallback", async () => {
			const c = await component({ renderResult });
			c.updateResult({ content: [{ type: "text", text: "corrective guidance remains readable" }] });
			expect(plain(c.render(40))).toContain("corrective guidance");
		});
	}
});

for (const themeName of ["xcsh-dark", "xcsh-light"]) {
	for (const preset of ["unicode", "ascii", "nerd"] as const) {
		test(`registered views reflow and retain values: ${themeName}/${preset}`, async () => {
			await initTheme(false, preset);
			await setTheme(themeName);
			const c = await component();
			const records = Array.from({ length: 240 }, (_, i) => ({
				id: `record-${i}`,
				total: 0,
				valid: false,
				missing: null,
				nested: { note: "界👩‍💻\nlast" },
			}));
			c.updateResult(
				{
					content: [
						{ type: "text", text: JSON.stringify({ records, done: false, warning: "Incomplete results" }) },
					],
				},
				true,
			);
			for (const width of [40, 76, 120, 153]) {
				c.setExpanded(false);
				const collapsed = c.render(width);
				expect(collapsed.every(line => visibleWidth(line) <= width)).toBe(true);
				expect(plain(collapsed)).toContain("237 more rows");
				expect(plain(collapsed)).toContain("Incomplete results");
				c.setExpanded(true);
				const expanded = c.render(width);
				expect(expanded.every(line => visibleWidth(line) <= width)).toBe(true);
				expect(plain(expanded).replace(/[\s│|]/g, "")).toContain("record-239");
				expect(plain(expanded)).toContain("false");
				expect(plain(expanded)).toContain("null");
			}
			c.updateResult(
				{
					content: [{ type: "text", text: "Cancelled by the user; no further work was performed." }],
					isError: true,
				},
				false,
			);
			expect(plain(c.render(40))).toContain("Cancelled");
		});
	}
}

test("presentation callbacks cannot mutate stored results or arguments", async () => {
	const c = await component({
		presentation: {
			result: (result: { content: { text: string }[] }) => {
				result.content[0].text = "mutated";
				return undefined;
			},
		},
	});
	const result = { content: [{ type: "text", text: "original payload" }] };
	c.updateResult(result);
	expect(plain(c.render(76))).toContain("original payload");
	expect(result.content[0].text).toBe("original payload");
});
test("explicit component takes precedence over a presentation descriptor", async () => {
	const c = await component({
		renderResult: () => new Text("explicit output", 0, 0),
		presentation: { result: () => ({ summary: "descriptor output" }) },
	});
	c.updateResult({ content: [{ type: "text", text: "raw output" }] });
	expect(plain(c.render(76))).toContain("explicit output");
	expect(plain(c.render(76))).not.toContain("descriptor output");
});
