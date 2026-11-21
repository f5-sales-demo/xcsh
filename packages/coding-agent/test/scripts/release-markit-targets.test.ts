import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { markitNativeBundlePlugin } from "../../../../scripts/markit-native-bundle";

test("release cross-compilation installs optional targets without changing the dependency contract", async () => {
	const workflowPath = path.resolve(import.meta.dir, "../../../../.github/workflows/ci.yml");
	const workflow = parse(await Bun.file(workflowPath).text());
	const steps = workflow.jobs["build-release"].steps as { run?: string; env?: Record<string, string> }[];
	const bootstrap = steps.findIndex(step => step.run === "bash scripts/ci-bun-install.sh");
	const targetInstall = steps.findIndex(step => step.run?.includes("--cpu '*' --os '*'"));
	const compile = steps.findIndex(step => step.run?.includes("ci-release-build-binaries.ts"));
	expect(targetInstall).toBeGreaterThan(bootstrap);
	expect(targetInstall).toBeLessThan(compile);
	expect(steps[targetInstall]?.run).toContain("--frozen-lockfile");
	expect(steps[targetInstall]?.run).toContain("--ignore-scripts");
	const verify = steps.findIndex(step => step.run?.includes("release-markit-targets.test.ts"));
	expect(verify).toBeGreaterThan(targetInstall);
	expect(verify).toBeLessThan(compile);
	expect(steps[verify]?.env?.XCSH_VERIFY_CROSS_TARGET).toBe("1");
});

// Host-only test jobs do not install other architectures. The release job
// explicitly enables this real cross-build after its frozen target installation.
test.skipIf(process.env.XCSH_VERIFY_CROSS_TARGET !== "1" || process.platform !== "linux" || process.arch !== "x64")(
	"current Markit compiles for Linux ARM64 from the x64 release host",
	async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "xcsh-markit-arm64-"));
		try {
			const entrypoint = path.join(directory, "entry.ts");
			const executable = path.join(directory, "convert-arm64");
			const modulePath = fileURLToPath(import.meta.resolve("@shiftlabs/markit"));
			await writeFile(
				entrypoint,
				`import { Markit } from ${JSON.stringify(modulePath)}; console.log(new Markit());`,
			);
			const result = await Bun.build({
				entrypoints: [entrypoint],
				compile: { target: "bun-linux-arm64", outfile: executable },
				plugins: [markitNativeBundlePlugin("linux", "arm64")],
				throw: false,
			});
			expect(result.success, result.logs.map(String).join("\n")).toBe(true);
			const header = Buffer.from(await Bun.file(executable).slice(0, 20).arrayBuffer());
			expect(header.subarray(0, 4).toString("hex")).toBe("7f454c46");
			expect(header.readUInt16LE(18)).toBe(183);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	},
	60000,
);
