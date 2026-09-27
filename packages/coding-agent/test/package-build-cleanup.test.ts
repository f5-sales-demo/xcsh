import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { type PackageBuildOperations, runPackageBuild } from "../scripts/build-package";

describe("coding-agent package build", () => {
	test("restores generated placeholders when preparation or compilation fails", async () => {
		for (const failure of ["prepare", "compile"] as const) {
			const events: string[] = [];
			const operations: PackageBuildOperations = {
				prepare: async () => {
					events.push("prepare");
					if (failure === "prepare") throw new Error("prepare failed");
				},
				compile: async () => {
					events.push("compile");
					throw new Error("compile failed");
				},
				reset: async () => {
					events.push("reset");
				},
			};

			await expect(runPackageBuild(operations)).rejects.toThrow(`${failure} failed`);
			expect(events.at(-1)).toBe("reset");
		}
	});

	test("is the package build entry point and resets the documentation embed", async () => {
		const packageRoot = path.resolve(import.meta.dir, "..");
		const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as {
			scripts: Record<string, string>;
		};
		const buildScript = await readFile(path.join(packageRoot, "scripts", "build-package.ts"), "utf8");

		expect(manifest.scripts.build).toBe("bun scripts/build-package.ts");
		expect(buildScript).toContain("generate-documentation-index");
		expect(buildScript).toContain('"generate-documentation-index", "--reset"');
	});
});

describe("release binary build", () => {
	test("generates and resets documentation inside the cleanup boundary and runs compiled QMD smoke", async () => {
		const releaseScript = await readFile(
			path.resolve(import.meta.dir, "../../..", "scripts", "ci-release-build-binaries.ts"),
			"utf8",
		);
		const mainStart = releaseScript.indexOf("async function main()");
		const tryStart = releaseScript.indexOf("try {", mainStart);
		const generate = releaseScript.indexOf("await generateDocumentationIndex();", mainStart);
		const finallyStart = releaseScript.indexOf("} finally {", tryStart);
		const reset = releaseScript.indexOf("await resetArtifacts();", finallyStart);

		expect(mainStart).toBeGreaterThan(-1);
		expect(tryStart).toBeGreaterThan(mainStart);
		expect(generate).toBeGreaterThan(tryStart);
		expect(generate).toBeLessThan(finallyStart);
		expect(reset).toBeGreaterThan(finallyStart);
		expect(releaseScript).toContain("XCSH_SMOKE_TEST_QMD");
	});
});
