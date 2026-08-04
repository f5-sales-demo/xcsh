import { describe, expect, test } from "bun:test";
import {
	assertSyntheticFixtureUsesRoleAliases,
	parseUatMeddpiccArgs,
	requireGatewayRootUrl,
	sanitizeEvidence,
} from "../scripts/uat-meddpicc-excel";

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

	test("rejects the removed private in-place mode", () => {
		expect(() => parseUatMeddpiccArgs(["--private-in-place"])).toThrow("Unknown option: --private-in-place");
	});

	test("requires reserved role aliases in every identity-bearing fixture field", () => {
		const fixture = {
			metadata: { reviewer: "<REVIEWER>" },
			stakeholders: [{ name: "<CHAMPION>", relationshipOwner: "<ACCOUNT_EXECUTIVE>" }],
			closePlan: { criticalActions: [{ owner: "<ACCOUNT_EXECUTIVE> (AE)" }] },
			team: {
				internal: [{ name: "<SOLUTIONS_ENGINEER>" }],
				partner: [{ name: "<PARTNER_ENGINEER>" }],
			},
		};
		expect(() => assertSyntheticFixtureUsesRoleAliases(fixture)).not.toThrow();
		expect(() =>
			assertSyntheticFixtureUsesRoleAliases({ ...fixture, metadata: { reviewer: "Account Executive" } }),
		).toThrow("role aliases");
	});

	test("rejects unknown and valueless options", () => {
		expect(() => parseUatMeddpiccArgs(["--model", "gpt-5.6-sol"])).toThrow("Unknown option");
		expect(() => parseUatMeddpiccArgs(["--binary", "--workspace", "/tmp/demo"])).toThrow("--binary requires a value");
	});

	test("normalizes legacy provider paths to one HTTPS gateway root", () => {
		expect(requireGatewayRootUrl(" https://gateway.example.com/api/v1/ ")).toBe("https://gateway.example.com");
		expect(requireGatewayRootUrl("https://gateway.example.com/anthropic")).toBe("https://gateway.example.com");
		expect(() => requireGatewayRootUrl("http://gateway.example.com/v1")).toThrow("https://");
	});

	test("redacts the local home directory and credentials from evidence", () => {
		const homeDirectory = "/Users/<DEVELOPER>";
		expect(
			sanitizeEvidence(
				{
					binary: { path: `${homeDirectory}/repo/xcsh` },
					detail: "token=<SYNTHETIC_SECRET>",
					files: [`${homeDirectory}/workspace/example-corp.json`],
				},
				["<SYNTHETIC_SECRET>"],
				homeDirectory,
			),
		).toEqual({
			binary: { path: "<HOME>/repo/xcsh" },
			detail: "token=[REDACTED]",
			files: ["<HOME>/workspace/example-corp.json"],
		});
	});
});
