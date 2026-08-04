import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	assertPrivateEvidenceOutsideWorkspace,
	discoverPrivateFixture,
	parseUatMeddpiccArgs,
	requireGatewayRootUrl,
	summarizePrivateRunEvidence,
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

	test("parses private in-place mode without requiring a synthetic fixture", () => {
		expect(
			parseUatMeddpiccArgs([
				"--binary=/tmp/xcsh",
				"--workspace=/private/customer",
				"--evidence=/tmp/private-evidence.json",
				"--private-in-place",
			]),
		).toEqual({
			binary: "/tmp/xcsh",
			workspace: "/private/customer",
			evidence: "/tmp/private-evidence.json",
			privateInPlace: true,
			printPrompts: false,
			help: false,
		});
	});

	test("rejects unknown and valueless options", () => {
		expect(() => parseUatMeddpiccArgs(["--model", "gpt-5.6-sol"])).toThrow("Unknown option");
		expect(() => parseUatMeddpiccArgs(["--binary", "--workspace", "/tmp/demo"])).toThrow("--binary requires a value");
	});

	test("private discovery accepts one top-level JSON file without copying it", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "xcsh-private-uat-"));
		await mkdir(join(workspace, "nested"));
		await writeFile(join(workspace, "private-deal.json"), "{}\n");
		await writeFile(join(workspace, "nested", "ignored.json"), "{}\n");
		const fixture = await discoverPrivateFixture(workspace);
		const resolvedWorkspace = await realpath(workspace);
		expect(fixture.workspace).toBe(resolvedWorkspace);
		expect(fixture.path).toBe(join(resolvedWorkspace, "private-deal.json"));
		expect(fixture.topLevelJsonFiles).toBe(1);
	});

	test("private discovery selects canonical meddpicc.json among unrelated top-level JSON files", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "xcsh-private-uat-multiple-"));
		await writeFile(join(workspace, "notes.json"), "{}\n");
		await writeFile(join(workspace, "meddpicc.json"), "{}\n");
		await writeFile(join(workspace, "settings.JSON"), "{}\n");
		const fixture = await discoverPrivateFixture(workspace);
		const resolvedWorkspace = await realpath(workspace);
		expect(fixture.path).toBe(join(resolvedWorkspace, "meddpicc.json"));
		expect(fixture.topLevelJsonFiles).toBe(3);
	});

	test("private discovery fails closed for zero or ambiguous top-level JSON files", async () => {
		const empty = await mkdtemp(join(tmpdir(), "xcsh-private-uat-empty-"));
		await expect(discoverPrivateFixture(empty)).rejects.toThrow("top-level JSON deal file");
		await writeFile(join(empty, "one.json"), "{}\n");
		await writeFile(join(empty, "two.json"), "{}\n");
		await expect(discoverPrivateFixture(empty)).rejects.toThrow("canonical meddpicc.json");
	});

	test("keeps private evidence outside the customer workspace, including through symlinks", async () => {
		const root = await mkdtemp(join(tmpdir(), "xcsh-private-evidence-"));
		const workspace = join(root, "private-workspace");
		const outside = join(root, "outside");
		await mkdir(workspace);
		await mkdir(outside);
		expect(await assertPrivateEvidenceOutsideWorkspace(workspace, join(outside, "evidence.json"))).toBe(
			join(await realpath(outside), "evidence.json"),
		);
		await expect(assertPrivateEvidenceOutsideWorkspace(workspace, join(workspace, "evidence.json"))).rejects.toThrow(
			"outside the private workspace",
		);

		const linkedWorkspace = join(outside, "linked-workspace");
		await symlink(workspace, linkedWorkspace);
		await expect(
			assertPrivateEvidenceOutsideWorkspace(workspace, join(linkedWorkspace, "evidence.json")),
		).rejects.toThrow("outside the private workspace");
	});

	test("private run evidence contains outcomes but no customer-bearing runtime values", () => {
		const summary = summarizePrivateRunEvidence({
			step: 5,
			repeat: 1,
			title: "Create and verify the private Excel summary",
			prompt: "PRIVATE PROMPT",
			ended: "chat_done",
			reason: "PRIVATE REASON",
			durationMs: 123,
			reply: "PRIVATE REPLY",
			toolNotices: [{ tool: "read", ok: true, detail: "PRIVATE TOOL DETAIL" }],
			hostToolCalls: [{ toolName: "write_range", arguments: { values: [["PRIVATE WORKBOOK VALUE"]] } }],
			filesBefore: [{ path: "PRIVATE FILE.json", sha256: "PRIVATE HASH", bytes: 10 }],
			filesAfter: [{ path: "PRIVATE FILE.json", sha256: "PRIVATE HASH", bytes: 10 }],
			workbookBefore: { activeSheet: "PRIVATE SHEET", sheets: {} },
			workbookAfter: { activeSheet: "PRIVATE SHEET", sheets: {} },
			assertions: [{ label: "workspace snapshot is unchanged", passed: true, detail: "PRIVATE DETAIL" }],
			passed: true,
		});

		expect(summary).toEqual({
			step: 5,
			repeat: 1,
			title: "Create and verify the private Excel summary",
			ended: "chat_done",
			durationMs: 123,
			assertions: [{ label: "workspace snapshot is unchanged", passed: true }],
			passed: true,
		});
		const serialized = JSON.stringify(summary);
		for (const forbidden of ["PRIVATE PROMPT", "PRIVATE REPLY", "PRIVATE FILE", "PRIVATE HASH", "PRIVATE WORKBOOK"]) {
			expect(serialized).not.toContain(forbidden);
		}
	});

	test("normalizes legacy provider paths to one HTTPS gateway root", () => {
		expect(requireGatewayRootUrl(" https://gateway.example.com/api/v1/ ")).toBe("https://gateway.example.com");
		expect(requireGatewayRootUrl("https://gateway.example.com/anthropic")).toBe("https://gateway.example.com");
		expect(() => requireGatewayRootUrl("http://gateway.example.com/v1")).toThrow("https://");
	});
});
