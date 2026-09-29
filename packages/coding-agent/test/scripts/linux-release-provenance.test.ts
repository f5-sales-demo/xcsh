import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createLinuxReleaseProvenance } from "../../../../scripts/linux-release-provenance";

describe("Linux release provenance", () => {
	it.each(["x64", "arm64"] as const)("records the exact %s embedded contract and portable checksums", async arch => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-linux-provenance-"));
		const names =
			arch === "x64"
				? ["pi_natives.linux-x64-baseline.node", "pi_natives.linux-x64-modern.node"]
				: ["pi_natives.linux-arm64.node"];
		try {
			for (const name of [`xcsh-linux-${arch}`, ...names])
				await fs.writeFile(path.join(root, name), `synthetic ${name}`);
			const manifest = await createLinuxReleaseProvenance({
				root,
				arch,
				version: "22.4.4",
				commit: "a".repeat(40),
				runId: "123",
				runAttempt: "2",
				buildPlatform: "linux-x64",
			});
			expect(manifest.natives.files.map(file => file.name)).toEqual(names);
			expect(manifest.source).toEqual({
				repository: "f5-sales-demo/xcsh",
				commit: "a".repeat(40),
				workflow: "ci.yml",
				runId: "123",
				runAttempt: "2",
				buildPlatform: "linux-x64",
			});
			const manifestName = `xcsh-linux-${arch}.provenance.json`;
			for (const name of [`xcsh-linux-${arch}`, manifestName, ...names]) {
				const bytes = await fs.readFile(path.join(root, name));
				const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
				expect(await fs.readFile(path.join(root, `${name}.sha256`), "utf8")).toBe(`${hash}  ${name}\n`);
			}
			expect(await fs.readFile(path.join(root, manifestName), "utf8")).not.toContain(root);
			await fs.rm(path.join(root, names[0]!));
			await expect(
				createLinuxReleaseProvenance({
					root,
					arch,
					version: "22.4.4",
					commit: "a".repeat(40),
					runId: "123",
					runAttempt: "2",
					buildPlatform: "linux-x64",
				}),
			).rejects.toThrow();
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});
	it("rejects incomplete or injected release identity before writing", async () => {
		await expect(
			createLinuxReleaseProvenance({
				root: "/does-not-exist",
				arch: "x64",
				version: "../../unsafe",
				commit: "main",
				runId: "",
				runAttempt: "1",
				buildPlatform: "linux-x64",
			}),
		).rejects.toThrow("Invalid Linux release identity");
	});
});
