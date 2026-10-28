import { expect, test } from "bun:test";
import { parseArgs } from "../../src/cli/args";

test("recognizes the immutable Herdr v4 reduced-discovery launch flags", () => {
	const result = parseArgs([
		"--mode",
		"json",
		"--session-dir",
		"/sessions",
		"--resume",
		"/sessions/native.jsonl",
		"--model",
		"openai-codex/gpt-6.1-sol",
		"--tools",
		"read,request_user_input,request_user_input_async",
		"--no-mcp",
		"--no-lsp",
		"--no-memories",
		"--no-skills",
		"--no-rules",
		"--no-pty",
		"--print",
		"read the fixture",
	]);
	expect(result.unrecognizedFlags).toEqual([]);
	expect(result.noMcp).toBe(true);
	expect(result.noLsp).toBe(true);
	expect(result.noMemories).toBe(true);
	expect(result.noSkills).toBe(true);
	expect(result.noRules).toBe(true);
	expect(result.noPty).toBe(true);
	expect(result.tools).toEqual(["read", "request_user_input", "request_user_input_async"]);
	expect(result.messages).toEqual(["read the fixture"]);
});
