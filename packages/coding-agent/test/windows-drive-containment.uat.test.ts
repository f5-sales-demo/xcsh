import { afterAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildContainmentFence, fenceVerdict, otherFilesystemRoots } from "../src/sandbox/containment";
import { evaluateToolCall } from "../src/sandbox/enforce";

const fixtures: string[] = [];

afterAll(() => {
	for (const fixture of fixtures) fs.rmSync(fixture, { recursive: true, force: true });
});

function canonical(value: string): string {
	return fs.realpathSync(value);
}

describe.skipIf(process.platform !== "win32")("native Windows multi-volume containment UAT", () => {
	it("discovers a real second volume and applies the discovery-only contract", () => {
		const workspace = canonical(process.cwd());
		const workspaceRoot = path.parse(workspace).root;
		const startedAt = performance.now();
		const otherRoots = otherFilesystemRoots(workspaceRoot);
		const elapsedMs = performance.now() - startedAt;

		console.info(
			JSON.stringify({
				workspaceRoot,
				otherRoots,
				discoveryElapsedMs: Math.round(elapsedMs),
			}),
		);

		expect(otherRoots.length).toBeGreaterThan(0);
		expect(elapsedMs).toBeLessThan(5_000);
		for (const root of otherRoots) {
			expect(fs.statSync(root).isDirectory()).toBe(true);
			expect(root.toLowerCase()).not.toBe(workspaceRoot.toLowerCase());
		}

		const otherRoot = otherRoots[0];
		const fence = buildContainmentFence({ workspace, home: os.homedir() });
		const otherCanonical = canonical(otherRoot);
		expect(fence.denyEnumerate.map(root => root.toLowerCase())).toContain(otherCanonical.toLowerCase());
		expect(fenceVerdict(fence, otherCanonical, "enumerate")).toBe("deny");
		expect(fenceVerdict(fence, workspaceRoot, "enumerate")).toBe("allow");

		const structuredRead = evaluateToolCall({
			toolName: "read",
			input: { file_path: otherRoot },
			cwd: workspace,
			fence,
		});
		const structuredSearch = evaluateToolCall({
			toolName: "grep",
			input: { pattern: "probe", path: otherRoot },
			cwd: workspace,
			fence,
		});
		expect(structuredRead.block).toBe(true);
		expect(structuredRead.reason).toContain("enumerate boundary");
		expect(structuredSearch.block).toBe(true);

		// #2931 deliberately treats arbitrary Bash/Python source as data. Windows has no runtime
		// backend, so these are statements of intent, not a claim of hard confinement.
		expect(
			evaluateToolCall({
				toolName: "bash",
				input: { command: `ls ${JSON.stringify(otherRoot)}` },
				cwd: workspace,
				fence,
			}).block,
		).toBe(false);
		expect(
			evaluateToolCall({
				toolName: "python",
				input: { code: `import os; os.listdir(${JSON.stringify(otherRoot)})` },
				cwd: workspace,
				fence,
			}).block,
		).toBe(false);
	});

	it("restores second-volume enumeration and named I/O with an explicit read-write grant", () => {
		const workspace = canonical(process.cwd());
		const workspaceRoot = path.parse(workspace).root;
		const otherRoots = otherFilesystemRoots(workspaceRoot);
		expect(otherRoots.length).toBeGreaterThan(0);

		let fixture: string | undefined;
		let otherRoot: string | undefined;
		const candidateBases = [os.homedir(), os.tmpdir(), process.env.RUNNER_TEMP, ...otherRoots].filter(
			(value): value is string => value !== undefined,
		);
		for (const root of otherRoots) {
			for (const base of candidateBases) {
				if (path.parse(base).root.toLowerCase() !== root.toLowerCase()) continue;
				try {
					fixture = fs.mkdtempSync(path.join(base, "xcsh-windows-drive-uat-"));
					otherRoot = root;
					fixtures.push(fixture);
					break;
				} catch {
					// Try the next known writable location on the same real volume.
				}
			}
			if (fixture !== undefined) break;
		}
		expect(fixture).toBeDefined();
		expect(otherRoot).toBeDefined();
		if (fixture === undefined || otherRoot === undefined) throw new Error("no writable secondary volume");

		const knownFile = path.join(fixture, "known.txt");
		fs.writeFileSync(knownFile, "known\n");
		const defaultFence = buildContainmentFence({ workspace, home: os.homedir() });
		expect(fenceVerdict(defaultFence, knownFile, "read")).toBe("allow");
		expect(fenceVerdict(defaultFence, knownFile, "write")).toBe("allow");

		const grantedFence = buildContainmentFence({
			workspace,
			home: os.homedir(),
			readOnlyRoots: [otherRoot],
			writeOnlyRoots: [otherRoot],
		});
		expect(fenceVerdict(grantedFence, canonical(otherRoot), "enumerate")).toBe("allow");
		expect(
			evaluateToolCall({
				toolName: "read",
				input: { file_path: otherRoot },
				cwd: workspace,
				fence: grantedFence,
			}).block,
		).toBe(false);
		expect(
			evaluateToolCall({
				toolName: "write",
				input: { file_path: knownFile },
				cwd: workspace,
				fence: grantedFence,
			}).block,
		).toBe(false);
	});
});
