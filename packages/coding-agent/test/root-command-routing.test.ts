import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { $ } from "bun";
import { findPrefixedCommand } from "../src/cli/root-command-routing";

const commands = new Set(["sandbox", "stats"]);
const isCommand = (token: string): boolean => commands.has(token);
const cli = path.resolve(import.meta.dir, "../src/cli.ts");

describe("root launch flag scope", () => {
	it("finds a subcommand after inline, repeated, and boolean launch flags", () => {
		expect(
			findPrefixedCommand(
				["--allow-path=/tmp/a", "--allow-path", "/tmp/b", "--no-sandbox", "sandbox", "check"],
				isCommand,
			),
		).toEqual({
			command: "sandbox",
			commandArgs: ["check"],
			prefixFlags: ["allow-path", "allow-path", "no-sandbox"],
		});
	});

	it("does not mistake a required flag value for a subcommand", () => {
		expect(findPrefixedCommand(["--model", "sandbox", "check"], isCommand)).toBeUndefined();
		expect(findPrefixedCommand(["--allow-path=sandbox", "check"], isCommand)).toBeUndefined();
	});

	it("leaves an invalid boolean value for the launch parser to reject", () => {
		expect(findPrefixedCommand(["--no-sandbox=true", "sandbox", "check"], isCommand)).toBeUndefined();
	});

	it("reports invalid launch-flag syntax as usage without an exception trace", async () => {
		const result = await $`${process.execPath} ${cli} --no-sandbox=true sandbox check`.quiet().nothrow();
		const stderr = result.stderr.toString();
		expect(result.exitCode).toBe(2);
		expect(stderr).toContain("--no-sandbox is a boolean flag and does not take a value");
		expect(stderr).not.toContain("Uncaught Exception");
		expect(stderr).not.toContain("flag-spec.ts");
	});

	it("requires an equals sign when an optional flag value is also a subcommand name", () => {
		expect(findPrefixedCommand(["--resume", "sandbox", "check"], isCommand)).toEqual({
			command: "sandbox",
			commandArgs: ["check"],
			prefixFlags: ["resume"],
		});
		expect(findPrefixedCommand(["--resume=sandbox", "check"], isCommand)).toBeUndefined();
	});

	it("preserves everything after the prompt delimiter as launch content", () => {
		expect(findPrefixedCommand(["--no-sandbox", "--", "sandbox", "check"], isCommand)).toBeUndefined();
	});

	it("does not rewrite an ordinary subcommand invocation", () => {
		expect(findPrefixedCommand(["sandbox", "check"], isCommand)).toBeUndefined();
	});
});
