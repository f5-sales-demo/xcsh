import { describe, expect, test } from "bun:test";
import { parseUatMeddpiccArgs, requireGatewayApiBaseUrl } from "../scripts/uat-meddpicc-excel";

describe("MEDDPICC Excel UAT CLI", () => {
	test("parses the four live-run paths and prompt flag", () => {
		expect(
			parseUatMeddpiccArgs([
				"--binary",
				"/tmp/xcsh",
				"--workspace=/tmp/demo",
				"--fixture",
				"/tmp/example-deal.json",
				"--evidence=/tmp/evidence.json",
				"--print-prompts",
			]),
		).toEqual({
			binary: "/tmp/xcsh",
			workspace: "/tmp/demo",
			fixture: "/tmp/example-deal.json",
			evidence: "/tmp/evidence.json",
			printPrompts: true,
			help: false,
		});
	});

	test("rejects unknown and valueless options", () => {
		expect(() => parseUatMeddpiccArgs(["--model", "gpt-5.6-sol"])).toThrow("Unknown option");
		expect(() => parseUatMeddpiccArgs(["--binary", "--workspace", "/tmp/demo"])).toThrow("--binary requires a value");
	});

	test("requires the full HTTPS OpenAI-compatible API base path", () => {
		expect(requireGatewayApiBaseUrl(" https://gateway.example.com/api/v1/ ")).toBe(
			"https://gateway.example.com/api/v1",
		);
		expect(() => requireGatewayApiBaseUrl("https://gateway.example.com")).toThrow("API base path");
		expect(() => requireGatewayApiBaseUrl("http://gateway.example.com/v1")).toThrow("https://");
	});
});
