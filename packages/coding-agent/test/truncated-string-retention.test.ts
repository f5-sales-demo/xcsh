import { describe, expect, test } from "bun:test";
import * as path from "node:path";

interface ProbeResult {
	retainedBytes: number;
	retainedChars: number;
}

const MAX_RETAINED_BYTES = 32 * 1024 * 1024;
const probePath = path.resolve(import.meta.dir, "fixtures", "truncated-string-retention-probe.ts");

async function runProbe(): Promise<ProbeResult> {
	const proc = Bun.spawn([process.execPath, "--smol", probePath], {
		cwd: path.resolve(import.meta.dir, "../.."),
		stderr: "pipe",
		stdout: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	expect(exitCode, stderr).toBe(0);
	const [retainedBytes, retainedChars] = stdout.trim().split("\n").map(Number);
	if (!Number.isFinite(retainedBytes) || !Number.isFinite(retainedChars)) {
		throw new Error(`invalid retention probe output: ${stdout}`);
	}
	return { retainedBytes, retainedChars };
}

describe("truncated string ownership", () => {
	test("tool-output windows do not retain oversized parent strings", async () => {
		const result = await runProbe();
		expect(result.retainedChars).toBeGreaterThan(0);
		expect(result.retainedBytes, JSON.stringify(result)).toBeLessThan(MAX_RETAINED_BYTES);
	});
});
