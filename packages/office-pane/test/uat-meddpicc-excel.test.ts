import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import {
	assertSyntheticFixtureUsesRoleAliases,
	assertVisionProbePassed,
	createSyntheticVisionProbe,
	directVisionProbePrompt,
	EXPECTED_PLUGIN_VERSION,
	fileVisionProbePrompt,
	parseUatMeddpiccArgs,
	requireGatewayRootUrl,
	requireMeddpiccScenarioModel,
	sanitizeEvidence,
	summarizeVisionProbe,
} from "../scripts/uat-meddpicc-excel";

describe("MEDDPICC Excel UAT CLI", () => {
	test("pins the current synthetic MEDDPICC release", () => {
		expect(EXPECTED_PLUGIN_VERSION).toBe("7.5.6");
	});

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

	test("generates a high-contrast synthetic PNG whose code is absent from both prompts", () => {
		const probe = createSyntheticVisionProbe("XC-48271");
		const header = Buffer.from(probe.bytes.subarray(0, 24));
		const png = Buffer.from(probe.bytes);
		const idat: Buffer[] = [];
		let offset = 8;
		while (offset < png.length) {
			const chunkLength = png.readUInt32BE(offset);
			const chunkType = png.subarray(offset + 4, offset + 8).toString("ascii");
			if (chunkType === "IDAT") idat.push(png.subarray(offset + 8, offset + 8 + chunkLength));
			offset += 12 + chunkLength;
		}
		const pixels = inflateSync(Buffer.concat(idat));

		expect(header.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
		expect(header.readUInt32BE(16)).toBeGreaterThanOrEqual(640);
		expect(header.readUInt32BE(20)).toBeGreaterThanOrEqual(160);
		expect(probe.mimeType).toBe("image/png");
		expect(probe.bytes.length).toBeGreaterThan(300);
		expect(pixels.includes(0x00)).toBe(true);
		expect(pixels.includes(0xff)).toBe(true);
		expect(directVisionProbePrompt()).not.toContain(probe.code);
		expect(fileVisionProbePrompt(probe.fileName)).not.toContain(probe.code);
	});

	test("rejects a synthetic vision code the bitmap font cannot render", () => {
		expect(() => createSyntheticVisionProbe("customer-code")).toThrow("XC-00000");
	});

	test("records image certification without base64, prompt secrets, codes, or replies", () => {
		const probe = createSyntheticVisionProbe("XC-48271");
		const direct = {
			id: "direct",
			reply: probe.code,
			ended: "chat_done" as const,
			durationMs: 10,
			toolNotices: [],
			hostToolCalls: [],
		};
		const inspected = {
			...direct,
			id: "inspect",
			durationMs: 20,
			toolNotices: [{ tool: "inspect_image", ok: true }],
		};

		const json = JSON.stringify(summarizeVisionProbe(probe, direct, inspected));
		expect(json).not.toContain(Buffer.from(probe.bytes).toString("base64"));
		expect(json).not.toContain(probe.code);
		expect(json).not.toContain("reply");
		expect(json).not.toContain("token");
		expect(json).toContain(probe.sha256);
		expect(json).toContain('"inspectImageToolObserved":true');
	});

	test("fails each direct and inspect-image oracle independently", () => {
		const probe = createSyntheticVisionProbe("XC-48271");
		const direct = {
			id: "direct",
			reply: probe.code,
			ended: "chat_done" as const,
			durationMs: 10,
			toolNotices: [],
			hostToolCalls: [],
		};
		const inspected = {
			...direct,
			id: "inspect",
			toolNotices: [{ tool: "inspect_image", ok: true }],
		};

		expect(summarizeVisionProbe(probe, direct, inspected).directAttachmentPassed).toBe(true);
		expect(summarizeVisionProbe(probe, direct, inspected).fileInspectionPassed).toBe(true);
		expect(summarizeVisionProbe(probe, { ...direct, reply: "WRONG" }, inspected).directAttachmentPassed).toBe(false);
		expect(summarizeVisionProbe(probe, { ...direct, ended: "chat_error" }, inspected).directAttachmentPassed).toBe(
			false,
		);
		expect(
			summarizeVisionProbe(
				probe,
				{ ...direct, hostToolCalls: [{ toolName: "unexpected", arguments: {} }] },
				inspected,
			).directAttachmentPassed,
		).toBe(false);
		expect(
			summarizeVisionProbe(probe, { ...direct, toolNotices: [{ tool: "read", ok: false }] }, inspected)
				.directAttachmentPassed,
		).toBe(false);
		expect(summarizeVisionProbe(probe, direct, { ...inspected, reply: "WRONG" }).fileInspectionPassed).toBe(false);
		expect(summarizeVisionProbe(probe, direct, { ...inspected, ended: "chat_error" }).fileInspectionPassed).toBe(
			false,
		);
		expect(summarizeVisionProbe(probe, direct, { ...inspected, toolNotices: [] }).fileInspectionPassed).toBe(false);
		const failedInspect = summarizeVisionProbe(probe, direct, {
			...inspected,
			toolNotices: [{ tool: "inspect_image", ok: false }],
		});
		expect(failedInspect.inspectImageToolObserved).toBe(false);
		expect(failedInspect.fileInspectionPassed).toBe(false);
		expect(
			summarizeVisionProbe(probe, direct, {
				...inspected,
				toolNotices: [
					{ tool: "inspect_image", ok: true },
					{ tool: "read", ok: false },
				],
			}).fileInspectionPassed,
		).toBe(false);
	});

	test("rejects either failed live vision certification before MEDDPICC runs", () => {
		const passed = {
			image: { fileName: "synthetic.png", mimeType: "image/png" as const, bytes: 400, sha256: "abc" },
			directAttachmentPassed: true,
			directAttachmentDurationMs: 10,
			fileInspectionPassed: true,
			fileInspectionDurationMs: 20,
			inspectImageToolObserved: true,
		};
		expect(() => assertVisionProbePassed(passed)).not.toThrow();
		expect(() => assertVisionProbePassed({ ...passed, directAttachmentPassed: false })).toThrow(
			"direct image attachment",
		);
		expect(() => assertVisionProbePassed({ ...passed, fileInspectionPassed: false })).toThrow("inspect_image");
	});

	test("requires the restored GPT model before the MEDDPICC scenario", () => {
		expect(requireMeddpiccScenarioModel("gpt-5.6-sol")).toBe("gpt-5.6-sol");
		expect(() => requireMeddpiccScenarioModel("claude-opus-5")).toThrow("did not start under GPT-5.6 Sol");
	});
});
