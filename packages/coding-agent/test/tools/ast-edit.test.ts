import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { adaptSchemaForStrict } from "@f5-sales-demo/pi-ai/utils/schema";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { Settings } from "@f5-sales-demo/xcsh/config/settings";
import { ToolChoiceQueue } from "@f5-sales-demo/xcsh/session/tool-choice-queue";
import { createTools, type ToolSession } from "@f5-sales-demo/xcsh/tools";
import { astEditToolRenderer } from "@f5-sales-demo/xcsh/tools/ast-edit";
import { getThemeByName } from "../../src/modes/theme/theme";

function createTestSession(cwd = "/tmp/test", overrides: Partial<ToolSession> = {}): ToolSession {
	return {
		cwd,
		hasUI: true,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated(),
		...overrides,
	};
}

function asSchemaObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Expected object schema");
	}
	return value as Record<string, unknown>;
}

describe("ast_edit tool schema", () => {
	it("uses op entries as [{ pat, out }]", async () => {
		const tools = await createTools(createTestSession());
		const tool = tools.find(entry => entry.name === "ast_edit");
		expect(tool).toBeDefined();
		const schema = asSchemaObject(tool?.parameters);
		const properties = asSchemaObject(schema.properties);
		const ops = asSchemaObject(properties.ops);

		expect(ops.type).toBe("array");
		const items = asSchemaObject(ops.items);
		expect(items.type).toBe("object");
		expect(items.required).toEqual(["pat", "out"]);
		const itemProperties = asSchemaObject(items.properties);
		expect(asSchemaObject(itemProperties.pat).type).toBe("string");
		expect(asSchemaObject(itemProperties.out).type).toBe("string");
		expect(properties.preview).toBeUndefined();
	});

	it("remains strict-representable after strict adaptation", async () => {
		const tools = await createTools(createTestSession());
		const tool = tools.find(entry => entry.name === "ast_edit");
		expect(tool).toBeDefined();
		const schema = asSchemaObject(tool?.parameters);

		const strict = adaptSchemaForStrict(schema, true);
		expect(strict.strict).toBe(true);
	});

	it("renders +/- lines with aligned hashline prefixes", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ast-edit-render-"));
		try {
			const filePath = path.join(tempDir, "legacy.ts");
			await Bun.write(filePath, "legacyWrap(x, value)\n");

			const tools = await createTools(createTestSession(tempDir));
			const tool = tools.find(entry => entry.name === "ast_edit");
			expect(tool).toBeDefined();

			const result = await tool!.execute("ast-edit-test", {
				ops: [{ pat: "legacyWrap($A, $B)", out: "modernWrap($A, $B)" }],
				lang: "typescript",
				path: filePath,
			});
			const text = result.content.find(content => content.type === "text")?.text ?? "";
			const lines = text.split("\n");
			const removedLine = lines.find(line => line.startsWith("-"));
			const addedLine = lines.find(line => line.startsWith("+"));

			expect(removedLine).toBeDefined();
			expect(addedLine).toBeDefined();
			expect(removedLine).toMatch(/^-\d+#\w+:/);
			expect(addedLine).toMatch(/^\+\d+#\w+:/);
			expect(removedLine?.split(":", 1)[0].length).toBe(addedLine?.split(":", 1)[0].length);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("registers a pending action that apply writes changes", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ast-edit-pending-"));
		try {
			const filePath = path.join(tempDir, "legacy.ts");
			await Bun.write(filePath, "legacyWrap(x, value)\n");
			const queue = new ToolChoiceQueue();

			const tools = await createTools(
				createTestSession(tempDir, {
					getToolChoiceQueue: () => queue,
					buildToolChoice: () => ({ type: "tool" as const, name: "resolve" }),
					steer: () => {},
				}),
			);
			const tool = tools.find(entry => entry.name === "ast_edit");
			expect(tool).toBeDefined();

			const previewResult = await tool!.execute("ast-edit-preview", {
				ops: [{ pat: "legacyWrap($A, $B)", out: "modernWrap($A, $B)" }],
				lang: "typescript",
				path: filePath,
			});
			expect(previewResult.details).toBeDefined();
			expect((previewResult.details as { applied?: boolean }).applied).toBe(false);

			expect(queue.inspect().some(l => l.startsWith("pending-action:ast_edit"))).toBe(true);
			queue.nextToolChoice();
			const invoker = queue.peekInFlightInvoker()!;
			await invoker({ action: "apply", reason: "apply previewed AST edit" });
			const updated = await Bun.file(filePath).text();
			expect(updated).toContain("modernWrap(x, value)");
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("combines globbing from path and glob parameters", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ast-edit-glob-"));
		try {
			const packagesDir = path.join(tempDir, "packages");
			const sourceDir = path.join(packagesDir, "pkg-123", "src");
			const nestedDir = path.join(sourceDir, "nested");
			await fs.mkdir(nestedDir, { recursive: true });
			await Bun.write(path.join(sourceDir, "root.ts"), "legacyWrap(rootValue, rootArg)\n");
			await Bun.write(path.join(nestedDir, "child.ts"), "legacyWrap(childValue, childArg)\n");
			await Bun.write(path.join(sourceDir, "ignore.js"), "legacyWrap(ignoreValue, ignoreArg)\n");
			await Bun.write(path.join(tempDir, "outside.ts"), "legacyWrap(outsideValue, outsideArg)\n");
			const queue = new ToolChoiceQueue();

			const tools = await createTools(
				createTestSession(tempDir, {
					getToolChoiceQueue: () => queue,
					buildToolChoice: () => ({ type: "tool" as const, name: "resolve" }),
					steer: () => {},
				}),
			);
			const tool = tools.find(entry => entry.name === "ast_edit");
			expect(tool).toBeDefined();

			const previewResult = await tool!.execute("ast-edit-glob", {
				ops: [{ pat: "legacyWrap($A, $B)", out: "modernWrap($A, $B)" }],
				lang: "typescript",
				path: `${packagesDir}/pkg-*/src`,
				glob: "**/*.ts",
			});

			const text = previewResult.content.find(content => content.type === "text")?.text ?? "";
			const details = previewResult.details as
				| { totalReplacements?: number; fileReplacements?: Array<{ path: string; count: number }> }
				| undefined;

			expect(text).toContain("## └─ root.ts (1 replacement)");
			expect(text).toContain("## └─ child.ts (1 replacement)");
			expect(text).not.toContain("ignore.js");
			expect(text).not.toContain("outside.ts");
			expect(details?.totalReplacements).toBe(2);
			expect(details?.fileReplacements).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ path: "pkg-123/src/root.ts", count: 1 }),
					expect.objectContaining({ path: "pkg-123/src/nested/child.ts", count: 1 }),
				]),
			);

			queue.nextToolChoice();
			const invoker = queue.peekInFlightInvoker()!;
			await invoker({ action: "apply", reason: "apply previewed AST edit with combined globs" });

			expect(await Bun.file(path.join(sourceDir, "root.ts")).text()).toContain("modernWrap(rootValue, rootArg)");
			expect(await Bun.file(path.join(nestedDir, "child.ts")).text()).toContain("modernWrap(childValue, childArg)");
			expect(await Bun.file(path.join(sourceDir, "ignore.js")).text()).toContain(
				"legacyWrap(ignoreValue, ignoreArg)",
			);
			expect(await Bun.file(path.join(tempDir, "outside.ts")).text()).toContain(
				"legacyWrap(outsideValue, outsideArg)",
			);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("infers tlaplus from .tla files for AST edits", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ast-edit-tlaplus-"));
		try {
			const filePath = path.join(tempDir, "Spec.tla");
			await Bun.write(filePath, `---- MODULE Spec ----\nVARIABLE x\n\nInit == x = 0\n\nNext == x' = x + 1\n====\n`);
			const queue = new ToolChoiceQueue();

			const tools = await createTools(
				createTestSession(tempDir, {
					getToolChoiceQueue: () => queue,
					buildToolChoice: () => ({ type: "tool" as const, name: "resolve" }),
					steer: () => {},
				}),
			);
			const tool = tools.find(entry => entry.name === "ast_edit");
			expect(tool).toBeDefined();

			const previewResult = await tool!.execute("ast-edit-tlaplus", {
				ops: [{ pat: "Init", out: "Start" }],
				path: filePath,
			});

			const text = previewResult.content.find(content => content.type === "text")?.text ?? "";
			const details = previewResult.details as { totalReplacements?: number; parseErrors?: string[] } | undefined;
			expect(text).toContain("Start");
			expect(details?.totalReplacements).toBe(1);
			expect(details?.parseErrors).toBeUndefined();

			queue.nextToolChoice();
			const invoker = queue.peekInFlightInvoker()!;
			await invoker({ action: "apply", reason: "apply tlaplus AST edit" });
			expect(await Bun.file(filePath).text()).toContain("Start == x = 0");
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});

describe("ast-edit renderResult has no terminal status glyph", () => {
	it("zero-replacement renderResult contains no glyph after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "" }],
			details: {
				totalReplacements: 0,
				filesTouched: 0,
				filesSearched: 3,
				applied: false,
				limitReached: false,
				scopePath: ".",
				files: [],
				fileReplacements: [],
			},
		};
		const component = astEditToolRenderer.renderResult(
			result as never,
			{ expanded: false, isPartial: false },
			theme!,
			{ ops: [{ pat: "noSuchPattern($A)", out: "replacement($A)" }] },
		);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});

	it("zero-replacement renderResult with parse errors contains no glyph after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "" }],
			details: {
				totalReplacements: 0,
				filesTouched: 0,
				filesSearched: 1,
				applied: false,
				limitReached: false,
				scopePath: ".",
				files: [],
				fileReplacements: [],
				parseErrors: ["broken.ts: parse error (syntax tree contains error nodes)"],
			},
		};
		const component = astEditToolRenderer.renderResult(
			result as never,
			{ expanded: false, isPartial: false },
			theme!,
			{ ops: [{ pat: "noSuchPattern($A)", out: "replacement($A)" }] },
		);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});

	it("success renderResult contains no glyph after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [
				{
					type: "text",
					text: "-1#abc:legacyWrap(x, value)\n+1#def:modernWrap(x, value)",
				},
			],
			details: {
				totalReplacements: 1,
				filesTouched: 1,
				filesSearched: 1,
				applied: false,
				limitReached: false,
				scopePath: ".",
				files: ["foo.ts"],
				fileReplacements: [{ path: "foo.ts", count: 1 }],
			},
		};
		const component = astEditToolRenderer.renderResult(
			result as never,
			{ expanded: false, isPartial: false },
			theme!,
			{ ops: [{ pat: "legacyWrap($A, $B)", out: "modernWrap($A, $B)" }] },
		);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});

	it("limit-reached renderResult contains no glyph after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [
				{
					type: "text",
					text: "-1#abc:legacyWrap(x, value)\n+1#def:modernWrap(x, value)",
				},
			],
			details: {
				totalReplacements: 1,
				filesTouched: 1,
				filesSearched: 1,
				applied: false,
				limitReached: true,
				scopePath: ".",
				files: ["foo.ts"],
				fileReplacements: [{ path: "foo.ts", count: 1 }],
			},
		};
		const component = astEditToolRenderer.renderResult(
			result as never,
			{ expanded: false, isPartial: false },
			theme!,
			{ ops: [{ pat: "legacyWrap($A, $B)", out: "modernWrap($A, $B)" }] },
		);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});
});

describe("ast-edit execute signals isWarning on 0 replacements", () => {
	it("result.isWarning is true when no replacements made", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ast-edit-isWarning-none-"));
		try {
			await Bun.write(path.join(tempDir, "hello.ts"), "const hello = 1;\n");
			const tools = await createTools(createTestSession(tempDir));
			const tool = tools.find(entry => entry.name === "ast_edit");
			expect(tool).toBeDefined();

			const result = await tool!.execute("ast-edit-isWarning-none", {
				ops: [{ pat: "astEditTask11NoSuchIdentifierXyz1234567890", out: "replacementXyz" }],
				lang: "typescript",
				path: tempDir,
			});

			expect(result.isWarning).toBe(true);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("result.isWarning is falsy when replacements made", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ast-edit-isWarning-match-"));
		try {
			await Bun.write(path.join(tempDir, "hello.ts"), "legacyWrap(x, value)\n");
			const queue = new ToolChoiceQueue();
			const tools = await createTools(
				createTestSession(tempDir, {
					getToolChoiceQueue: () => queue,
					buildToolChoice: () => ({ type: "tool" as const, name: "resolve" }),
					steer: () => {},
				}),
			);
			const tool = tools.find(entry => entry.name === "ast_edit");
			expect(tool).toBeDefined();

			const result = await tool!.execute("ast-edit-isWarning-match", {
				ops: [{ pat: "legacyWrap($A, $B)", out: "modernWrap($A, $B)" }],
				lang: "typescript",
				path: tempDir,
			});

			expect(result.isWarning).toBeFalsy();
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});
