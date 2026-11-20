import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runPackageBuild } from "../../scripts/build-package";
import { runFreshCorpusCheck } from "../../scripts/prepare-verified-corpora";

test("fresh verification uses a new process after the parent imported an old mapping", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "corpus-cache-"));
	try {
		const modulePath = path.join(root, "mapping.ts");
		await writeFile(modulePath, 'export const version = "old";\n');
		const cached = await import(modulePath);
		expect(cached.version).toBe("old");
		await writeFile(modulePath, 'export const version = "new";\n');
		expect((await import(modulePath)).version).toBe("old");
		await mkdir(path.join(root, "scripts"));
		await writeFile(
			path.join(root, "scripts/check-corpus-freshness.ts"),
			'import { version } from "../mapping";\n' +
				'if (version !== "new") throw new Error("stale cached mapping");\n' +
				'await Bun.write(new URL("../verified.json", import.meta.url), JSON.stringify({ version, pid: process.pid }));\n',
		);
		await runFreshCorpusCheck(root);
		const result = JSON.parse(await readFile(path.join(root, "verified.json"), "utf8"));
		expect(result.version).toBe("new");
		expect(result.pid).not.toBe(process.pid);
		expect(cached.version).toBe("old");
	} finally {
		await rm(root, { recursive: true });
	}
});

for (const stage of ["prepare", "compile"] as const) {
	test(`${stage} failure remains attributable when reset also fails`, async () => {
		const primary = new Error(`${stage} original failure`);
		const reset = new Error("reset original failure");
		let compiled = false;
		let failure: unknown;
		try {
			await runPackageBuild({
				prepare: async () => {
					if (stage === "prepare") throw primary;
				},
				compile: async () => {
					compiled = true;
					throw primary;
				},
				reset: async () => {
					throw reset;
				},
			});
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(AggregateError);
		expect((failure as AggregateError).errors).toContain(primary);
		expect((failure as AggregateError).errors).toContain(reset);
		expect(compiled).toBe(stage === "compile");
	});
}
