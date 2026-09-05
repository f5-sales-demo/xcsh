import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { stageMacOsPackage } from "../../../../scripts/ci-release-macos-pkg";

describe("macOS pkg payload", () => {
	it("stages the CLI and matching signed addons at stable install paths", async () => {
		const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-pkg-test-"));
		const nativeDir = path.join(fixture, "natives");
		const rootDir = path.join(fixture, "root");
		const binaryPath = path.join(fixture, "xcsh-darwin-arm64");
		try {
			await fs.mkdir(nativeDir);
			await Bun.write(binaryPath, "binary");
			await Bun.write(path.join(nativeDir, "pi_natives.darwin-arm64.node"), "arm addon");
			await Bun.write(path.join(nativeDir, "pi_natives.darwin-x64-modern.node"), "wrong arch");

			const staged = await stageMacOsPackage({
				arch: "arm64",
				version: "21.11.9",
				binaryPath,
				nativeDir,
				rootDir,
			});

			expect(staged).toEqual([
				path.join(rootDir, "usr/local/bin/xcsh"),
				path.join(rootDir, "Library/Application Support/xcsh/natives/21.11.9/pi_natives.darwin-arm64.node"),
			]);
			expect(await fs.readFile(staged[1], "utf8")).toBe("arm addon");
		} finally {
			await fs.rm(fixture, { recursive: true, force: true });
		}
	});

	it("fails closed when the matching addon is absent", async () => {
		const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-pkg-test-"));
		try {
			await fs.mkdir(path.join(fixture, "natives"));
			await Bun.write(path.join(fixture, "xcsh"), "binary");
			await expect(
				stageMacOsPackage({
					arch: "x64",
					version: "21.11.9",
					binaryPath: path.join(fixture, "xcsh"),
					nativeDir: path.join(fixture, "natives"),
					rootDir: path.join(fixture, "root"),
				}),
			).rejects.toThrow("No signed native addons found for darwin-x64");
		} finally {
			await fs.rm(fixture, { recursive: true, force: true });
		}
	});
});
