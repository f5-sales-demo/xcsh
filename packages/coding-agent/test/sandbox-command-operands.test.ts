import { describe, expect, it } from "bun:test";
import { operandWordsRequiringWrite, writtenOperandWords } from "../src/sandbox/command-operands";
import { lexShellCommand } from "../src/tools/shell-lex";

function written(command: string): string[] {
	return lexShellCommand(command).commands.flatMap(cmd => writtenOperandWords(cmd).map(word => word.text));
}

function writeRequired(command: string): string[] {
	return lexShellCommand(command).commands.flatMap(cmd => operandWordsRequiringWrite(cmd).map(word => word.text));
}

describe("writtenOperandWords", () => {
	it("identifies explicit output operands", () => {
		expect(written("tee a.log b.log")).toEqual(["a.log", "b.log"]);
		expect(written("dd if=input.img of=/drop/output.img")).toEqual(["/drop/output.img"]);
		expect(written("sort -o sorted.txt input.txt")).toEqual(["sorted.txt"]);
		expect(written("curl --output=result.json https://example.com")).toEqual(["result.json"]);
	});

	it("distinguishes destinations from read-only source operands", () => {
		expect(written("cp source.txt destination.txt")).toEqual(["destination.txt"]);
		expect(written("cp -t destination source-a source-b")).toEqual(["destination"]);
		expect(written("cp --target-directory=destination source-a source-b")).toEqual(["destination"]);
		expect(written("mv source.txt destination.txt")).toEqual(["source.txt", "destination.txt"]);
	});

	it("does not misclassify non-path option values as destinations", () => {
		expect(written("install -m 0755 -o root source.txt destination.txt")).toEqual(["destination.txt"]);
		expect(written("cp -S .backup source.txt destination.txt")).toEqual(["destination.txt"]);
		expect(written("cp -S -backup source.txt destination.txt")).toEqual(["destination.txt"]);
		expect(written("sort -k 2 -S 1M -o output.txt input.txt")).toEqual(["output.txt"]);
	});

	it("abandons positional inference when an option is unknown", () => {
		expect(written("cp --future-option source.txt destination.txt")).toEqual([]);
		expect(written("tee --future-option output.txt")).toEqual([]);
	});
});

describe("operandWordsRequiringWrite", () => {
	it("fails closed for literal operands of an unmodelled command", () => {
		expect(writeRequired("git init /shared/ctx/repo")).toContain("/shared/ctx/repo");
		expect(writeRequired("tar -xf archive.tar -C /shared/ctx")).toContain("/shared/ctx");
		expect(writeRequired("custom --output=/shared/ctx/file")).toContain("/shared/ctx/file");
	});

	it("returns no writes for explicitly read-only commands", () => {
		for (const command of ["cat /shared/x", "grep x /shared/x", "head /shared/x", "stat /shared/x"]) {
			expect(writeRequired(command)).toEqual([]);
		}
	});

	it("retains precise direction for modelled writers", () => {
		expect(writeRequired("cp /shared/source local-destination")).toEqual(["local-destination"]);
		expect(writeRequired("sed -n p /shared/source")).toEqual([]);
	});
});
