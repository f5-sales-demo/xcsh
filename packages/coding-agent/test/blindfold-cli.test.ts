import { describe, expect, test } from "bun:test";
import { parseBlindfoldCli } from "../src/commands/blindfold-args";

describe("Blindfold CLI compatibility syntax", () => {
	test("maps the three secrets paths and positional or flag inputs", () => {
		expect(parseBlindfoldCli(["secrets", "get-public-key"], true, false).operation).toBe("public-key");
		expect(
			parseBlindfoldCli(["secrets", "get-policy-document", "-n", "shared", "--name", "custom"], true, false),
		).toMatchObject({ operation: "policy", namespace: "shared", name: "custom" });
		for (const tail of [["key.pem"], ["--input", "key.pem"], ["--", "-key.pem"]])
			expect(parseBlindfoldCli(["secrets", "encrypt", ...tail], true, false).input).toBe(tail.at(-1));
	});
	test("explicit and redirected stdin are selected; interactive missing input fails", () => {
		expect(parseBlindfoldCli(["encrypt", "-"], false, false).input).toBe("-");
		expect(parseBlindfoldCli(["encrypt"], false, false).input).toBe("-");
		expect(() => parseBlindfoldCli(["encrypt"], false, true)).toThrow("input");
	});
	test("rejects usage before any I/O", () => {
		for (const argv of [
			["encrypt", "a", "b"],
			["encrypt", "a", "--input", "b"],
			["encrypt", "a", "--wat"],
			["encrypt", "a", "--public-key", "pub"],
			["encrypt", "a", "--json", "--output-file", "out"],
			["encrypt", "a", "--output", "yaml"],
			["policy", "--policy", "shared/custom", "--namespace", "shared"],
			["public-key", "extra"],
			["public-key", "--name", "oops"],
			["encrypt", "a", "--context-name", "online", "--public-key", "pub", "--policy-document", "policy"],
		])
			expect(() => parseBlindfoldCli(argv, false, false)).toThrow();
		expect(() => parseBlindfoldCli(["rpc"], true, false)).toThrow();
		expect(() => parseBlindfoldCli(["secrets", "encrypt", "a", "--config", "x"], true, false)).toThrow("context");
	});
});
