import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { markitNativeBundlePlugin, markitNativePackage } from "../../../../scripts/markit-native-bundle";

test.skipIf(!markitNativePackage(process.platform, process.arch))(
	"compiled Markit converts HTML outside the source and dependency directories",
	async () => {
		const directory = mkdtempSync(path.join(os.tmpdir(), "xcsh-markit-bundle-"));
		try {
			const entrypoint = path.join(directory, "entry.ts");
			const executable = path.join(directory, "convert");
			const modulePath = fileURLToPath(import.meta.resolve("@shiftlabs/markit"));
			writeFileSync(
				entrypoint,
				`import { Markit } from ${JSON.stringify(modulePath)};
const result = await new Markit().convert(Buffer.from("<h1>Standalone conversion</h1><p>Synthetic HTML input.</p>"), {extension:".html"});
console.log(JSON.stringify({markdown:result.markdown}));`,
			);
			const build = await Bun.build({
				entrypoints: [entrypoint],
				compile: { outfile: executable },
				plugins: [markitNativeBundlePlugin()],
				throw: true,
			});
			expect(build.success).toBe(true);
			const result = Bun.spawnSync([executable], {
				cwd: directory,
				env: { PATH: directory, HOME: directory, TMPDIR: directory },
				stdout: "pipe",
				stderr: "pipe",
				timeout: 15000,
			});
			expect(result.stderr.toString()).toBe("");
			expect(result.exitCode).toBe(0);
			expect(JSON.parse(result.stdout.toString()).markdown).toContain("# Standalone conversion");
			expect(JSON.parse(result.stdout.toString()).markdown).toContain("Synthetic HTML input.");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	},
	30000,
);

test("a changed vendor loader fails the build instead of producing a broken executable", async () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "xcsh-markit-loader-"));
	try {
		const vendorDirectory = path.join(directory, "@shiftlabs/markit/dist");
		mkdirSync(vendorDirectory, { recursive: true });
		const entrypoint = path.join(vendorDirectory, "native-markit.js");
		writeFileSync(entrypoint, "export const changedVendorLoader = true;");
		await expect(Bun.build({ entrypoints: [entrypoint], plugins: [markitNativeBundlePlugin()] })).rejects.toThrow(
			"Bundle failed",
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
