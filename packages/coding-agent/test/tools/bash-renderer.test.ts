import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5xc-salesdemos/pi-natives";
import { ImageProtocol, TERMINAL } from "@f5xc-salesdemos/pi-tui";
import { bashToolRenderer } from "@f5xc-salesdemos/xcsh/tools/bash";
import { _resetSettingsForTest, Settings } from "../../src/config/settings";
import { SETTINGS_SCHEMA } from "../../src/config/settings-schema";
import { getThemeByName } from "../../src/modes/theme/theme";

function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("bash renderResult has no terminal status glyph", () => {
	it("success renderResult contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "hello\n" }],
			isError: false,
		};
		const component = bashToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			command: "echo hello",
		});
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});

	it("error renderResult contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "command failed: exit 1" }],
			isError: true,
		};
		const component = bashToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			command: "false",
		});
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});
});

describe("bash.verbose setting", () => {
	it("defaults to false in schema", () => {
		const schema = SETTINGS_SCHEMA["bash.verbose"];
		expect(schema).toBeDefined();
		expect(schema.type).toBe("boolean");
		expect(schema.default).toBe(false);
	});
});

describe("bash description parameter", () => {
	it("renderCall accepts description in args without error", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const component = bashToolRenderer.renderCall(
			{ command: "npm install", description: "Install dependencies" },
			{ expanded: false, isPartial: false },
			theme!,
		);
		const lines = component.render(120);
		expect(lines.length).toBeGreaterThan(0);
	});

	it("renderCall shows description instead of command when provided", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const component = bashToolRenderer.renderCall(
			{ command: "npm install --save-exact foo@1.2.3", description: "Install dependencies" },
			{ expanded: false, isPartial: false },
			theme!,
		);
		const rendered = stripAnsi(component.render(120).join("\n"));
		expect(rendered).toContain("Install dependencies");
		expect(rendered).not.toContain("npm install");
	});

	it("renderCall falls back to command when no description", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const component = bashToolRenderer.renderCall(
			{ command: "npm install" },
			{ expanded: false, isPartial: false },
			theme!,
		);
		const rendered = stripAnsi(component.render(120).join("\n"));
		expect(rendered).toContain("npm install");
	});
});

describe("bash collapsed view (bash.verbose=false)", () => {
	let theme: Awaited<ReturnType<typeof getThemeByName>>;

	beforeAll(async () => {
		_resetSettingsForTest();
		await Settings.init({ inMemory: true, overrides: { "bash.verbose": false } });
		theme = await getThemeByName("xcsh-dark");
	});

	afterAll(() => {
		_resetSettingsForTest();
	});

	it("renders single status line with description on success", () => {
		const result = {
			content: [{ type: "text", text: "added 150 packages\n" }],
			isError: false,
		};
		const component = bashToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			command: "npm install",
			description: "Install dependencies",
		});
		const rendered = stripAnsi(component.render(120).join("\n"));
		expect(rendered).toContain("Install dependencies");
		expect(rendered).not.toContain("added 150 packages");
		expect(rendered).not.toContain("Output");
	});

	it("falls back to truncated command when no description", () => {
		const longCommand =
			"npm install --save-exact @some-very-long-scoped-package/with-a-really-long-name@1.2.3-beta.4";
		const result = {
			content: [{ type: "text", text: "some verbose output\n" }],
			isError: false,
		};
		const component = bashToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			command: longCommand,
		});
		const rendered = stripAnsi(component.render(120).join("\n"));
		expect(rendered).toContain("…");
		expect(rendered).toContain("npm install");
		expect(rendered).not.toContain("$ ");
		expect(rendered).not.toContain("some verbose output");
		expect(rendered).not.toContain("Output");
	});

	it("auto-expands on error", () => {
		const result = {
			content: [{ type: "text", text: "permission denied\n" }],
			isError: true,
		};
		const component = bashToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			command: "rm -rf /",
			description: "Delete everything",
		});
		const rendered = stripAnsi(component.render(120).join("\n"));
		expect(rendered).toContain("permission denied");
		expect(rendered).toContain("Output");
	});

	it("auto-expands when SIXEL image output is present", () => {
		const sixelData = "\x1bPq#0;2;0;0;0#0\x1b\\";
		const result = {
			content: [{ type: "text", text: sixelData }],
			isError: false,
		};
		const origProtocol = TERMINAL.imageProtocol;
		(TERMINAL as { imageProtocol: ImageProtocol | null }).imageProtocol = ImageProtocol.Sixel;
		const component = bashToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			command: "render-image",
			description: "Render image",
		});
		const lines = component.render(120);
		(TERMINAL as { imageProtocol: ImageProtocol | null }).imageProtocol = origProtocol;
		const rendered = stripAnsi(lines.join("\n"));
		expect(rendered).toContain("Output");
	});

	it("auto-expands when async details present", () => {
		const result = {
			content: [{ type: "text", text: "Background job bg_123 started\n" }],
			details: { async: { state: "running" as const, jobId: "bg_123", type: "bash" as const } },
			isError: false,
		};
		const component = bashToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			command: "long-task",
			description: "Run long task",
		});
		const rendered = stripAnsi(component.render(120).join("\n"));
		expect(rendered).toContain("Background job bg_123");
		expect(rendered).toContain("Output");
	});

	it("expands when ctrl+o override is active", () => {
		const result = {
			content: [{ type: "text", text: "detailed output here\n" }],
			isError: false,
		};
		const component = bashToolRenderer.renderResult(result as never, { expanded: true, isPartial: false }, theme!, {
			command: "echo test",
			description: "Run test",
		});
		const rendered = stripAnsi(component.render(120).join("\n"));
		expect(rendered).toContain("detailed output here");
	});

	it("streaming: shows description and suppresses raw output", () => {
		const result = {
			content: [{ type: "text", text: "line 1\nline 2\nline 3\nline 4\nline 5\n" }],
			isError: false,
		};
		const component = bashToolRenderer.renderResult(
			result as never,
			{ expanded: false, isPartial: true, spinnerFrame: 0 },
			theme!,
			{ command: "npm install", description: "Install dependencies" },
		);
		const rendered = stripAnsi(component.render(120).join("\n"));
		expect(rendered).toContain("Install dependencies");
		expect(rendered).not.toContain("line 1");
		expect(rendered).not.toContain("Output");
	});

	it("streaming: shows live line count", () => {
		const result = {
			content: [{ type: "text", text: "first\nsecond\nthird\n" }],
			isError: false,
		};
		const component = bashToolRenderer.renderResult(
			result as never,
			{ expanded: false, isPartial: true, spinnerFrame: 0 },
			theme!,
			{ command: "make build", description: "Build project" },
		);
		const rendered = stripAnsi(component.render(120).join("\n"));
		expect(rendered).toContain("lines");
	});

	it("streaming: omits line count when output is empty", () => {
		const result = {
			content: [{ type: "text", text: "" }],
			isError: false,
		};
		const component = bashToolRenderer.renderResult(
			result as never,
			{ expanded: false, isPartial: true, spinnerFrame: 0 },
			theme!,
			{ command: "sleep 5", description: "Wait for process" },
		);
		const rendered = stripAnsi(component.render(120).join("\n"));
		expect(rendered).toContain("Wait for process");
		expect(rendered).not.toContain("lines");
	});

	it("streaming: does not suppress output when verbose is true", async () => {
		_resetSettingsForTest();
		await Settings.init({ inMemory: true, overrides: { "bash.verbose": true } });
		try {
			const result = {
				content: [{ type: "text", text: "visible output\n" }],
				isError: false,
			};
			const component = bashToolRenderer.renderResult(
				result as never,
				{ expanded: false, isPartial: true, spinnerFrame: 0 },
				theme!,
				{ command: "echo test", description: "Run test" },
			);
			const rendered = stripAnsi(component.render(120).join("\n"));
			expect(rendered).toContain("visible output");
		} finally {
			_resetSettingsForTest();
			await Settings.init({ inMemory: true, overrides: { "bash.verbose": false } });
		}
	});
});

describe("bash verbose mode (bash.verbose=true)", () => {
	let theme: Awaited<ReturnType<typeof getThemeByName>>;

	beforeAll(async () => {
		_resetSettingsForTest();
		await Settings.init({ inMemory: true, overrides: { "bash.verbose": true } });
		theme = await getThemeByName("xcsh-dark");
	});

	afterAll(() => {
		_resetSettingsForTest();
	});

	it("renders full output panel when verbose is true", () => {
		const result = {
			content: [{ type: "text", text: "added 150 packages\n" }],
			isError: false,
		};
		const component = bashToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			command: "npm install",
			description: "Install dependencies",
		});
		const rendered = stripAnsi(component.render(120).join("\n"));
		expect(rendered).toContain("added 150 packages");
		expect(rendered).toContain("Output");
	});
});

describe("bash collapsed view — Settings not initialized", () => {
	let theme: Awaited<ReturnType<typeof getThemeByName>>;

	beforeAll(async () => {
		_resetSettingsForTest();
		theme = await getThemeByName("xcsh-dark");
	});

	it("defaults to collapsed when Settings is not initialized (no crash)", () => {
		const result = {
			content: [{ type: "text", text: "output text\n" }],
			isError: false,
		};
		const component = bashToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			command: "echo test",
			description: "Run test",
		});
		const rendered = stripAnsi(component.render(120).join("\n"));
		expect(rendered).toContain("Run test");
		expect(rendered).not.toContain("output text");
	});
});
