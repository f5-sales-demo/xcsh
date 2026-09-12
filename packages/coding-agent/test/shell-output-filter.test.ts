import { expect, test } from "bun:test";
import { ShellOutputFilter } from "../src/exec/shell-output-filter";

test("shell metadata is removed across every chunk boundary while ordinary output survives", () => {
	const frame = "<fixture-frame>cwd\nexit=7</fixture-frame>\n";
	const input = `first${frame}second`;
	for (let split = 0; split <= input.length; split++) {
		const chunks: string[] = [];
		const filter = new ShellOutputFilter("<fixture-frame>", "</fixture-frame>\n", text => chunks.push(text));
		filter.push(input.slice(0, split));
		filter.push(input.slice(split));
		filter.finish();
		expect(chunks.join("")).toBe("firstsecond");
	}
});

test("ordinary marker prefixes are preserved and completion prevents late data", () => {
	const chunks: string[] = [];
	const filter = new ShellOutputFilter("<fixture-frame>", "</fixture-frame>\n", text => chunks.push(text));
	for (const char of "one<fixture-fraXtwo<fixture-") filter.push(char);
	filter.finish();
	filter.push("late");
	filter.finish();
	expect(chunks.join("")).toBe("one<fixture-fraXtwo<fixture-");
});

test("an interrupted metadata frame is not exposed as command output", () => {
	const chunks: string[] = [];
	const filter = new ShellOutputFilter("<fixture-frame>", "</fixture-frame>\n", text => chunks.push(text));
	filter.push("first<fixture-frame>private bookkeeping");
	filter.finish();
	expect(chunks.join("")).toBe("first");
});
