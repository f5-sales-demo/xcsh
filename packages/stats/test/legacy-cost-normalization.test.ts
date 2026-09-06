import { describe, expect, it } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { TempDir } from "@f5-sales-demo/pi-utils";

describe("legacy usage costs", () => {
	it("normalizes a partial cost before inserting into NOT NULL columns", async () => {
		using tempDir = TempDir.createSync("@xcsh-stats-legacy-cost-");
		const configDir = path.relative(os.homedir(), tempDir.path());
		const child = Bun.spawn(
			[process.execPath, path.join(import.meta.dir, "fixtures/legacy-cost-normalization-probe.ts")],
			{
				cwd: path.join(import.meta.dir, ".."),
				env: {
					...Bun.env,
					PI_CONFIG_DIR: configDir,
					PI_CODING_AGENT_DIR: path.join(tempDir.path(), "agent"),
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		expect(exitCode, stderr).toBe(0);
		expect(JSON.parse(stdout)).toEqual({
			inserted: 2,
			partialCost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 1 },
			storedCompleteCost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 },
		});
	});
});
