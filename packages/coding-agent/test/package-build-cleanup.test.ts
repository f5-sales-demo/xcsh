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
	test("reuses one verified Linux-generated documentation index on every release platform", async () => {
		const root = path.resolve(import.meta.dir, "../../..");
		const workflow = await readFile(path.join(root, ".github/workflows/ci.yml"), "utf8");
		const releaseScript = await readFile(path.join(root, "scripts/ci-release-build-binaries.ts"), "utf8");
		const generator = await readFile(
			path.join(root, "packages/coding-agent/scripts/generate-documentation-index.ts"),
			"utf8",
		);
		const prepare =
			workflow.match(/\n {2}prepare-documentation-index:\n[\s\S]*?(?=\n {2}[a-z][a-z-]+:\n)/)?.[0] ?? "";
		const linuxWindows = workflow.match(/\n {2}build-release:\n[\s\S]*?(?=\n {2}[a-z][a-z-]+:\n)/)?.[0] ?? "";
		const macos = workflow.match(/\n {2}build-sign-macos:\n[\s\S]*?(?=\n {2}[a-z][a-z-]+:\n)/)?.[0] ?? "";

		expect(prepare).toContain("runs-on: xcsh-compute");
		expect(prepare).toContain("bun --cwd=packages/coding-agent run generate-documentation-index");
		// biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
		expect(prepare).toContain("name: documentation-index-${{ github.sha }}");
		expect(prepare).toContain("include-hidden-files: true");
		for (const job of [linuxWindows, macos]) {
			expect(job).toContain("prepare-documentation-index");
			expect(job).toContain("actions/download-artifact@");
			// biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
			expect(job).toContain("name: documentation-index-${{ github.sha }}");
			expect(job).toContain("XCSH_DOCUMENTATION_INDEX_MODE: prebuilt");
		}
		expect(releaseScript).toContain('Bun.env.XCSH_DOCUMENTATION_INDEX_MODE === "prebuilt"');
		expect(releaseScript).toContain("generate-documentation-index --use-existing");
		expect(generator).toContain('process.argv.includes("--use-existing")');
		expect(generator).toContain("verifyPrebuiltDocumentationAssets");
	});

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
