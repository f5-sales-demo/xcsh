#!/usr/bin/env bun
import * as fs from "node:fs/promises";
import * as path from "node:path";

interface LinuxReleaseIdentity {
	root: string;
	arch: "x64" | "arm64";
	version: string;
	commit: string;
	runId: string;
	runAttempt: string;
	buildPlatform: string;
}

/** Hash the final compiled binary and the exact addons embedded by the release build. */
export async function createLinuxReleaseProvenance(identity: LinuxReleaseIdentity) {
	const { root, arch, version, commit, runId, runAttempt, buildPlatform } = identity;
	if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version) || !/^[a-f0-9]{40}$/.test(commit)
		|| !/^[1-9][0-9]*$/.test(runId) || !/^[1-9][0-9]*$/.test(runAttempt)
		|| buildPlatform !== "linux-x64" || !["x64", "arm64"].includes(arch)) {
		throw new Error("Invalid Linux release identity");
	}
	const nativeNames = arch === "x64"
		? ["pi_natives.linux-x64-baseline.node", "pi_natives.linux-x64-modern.node"]
		: ["pi_natives.linux-arm64.node"];
	const inspect = async (name: string) => {
		const bytes = await fs.readFile(path.join(root, name));
		if (!bytes.length) throw new Error(`Empty Linux release artifact: ${name}`);
		return { name, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"), size: bytes.length };
	};
	const binary = await inspect(`xcsh-linux-${arch}`);
	const files = await Promise.all(nativeNames.map(inspect));
	const manifest = {
		schemaVersion: 1, version, platform: "linux", arch,
		source: { repository: "f5-sales-demo/xcsh", commit, workflow: "ci.yml", runId, runAttempt, buildPlatform },
		binary, natives: { mode: "embedded", files },
	};
	const manifestName = `${binary.name}.provenance.json`;
	await fs.writeFile(path.join(root, manifestName), `${JSON.stringify(manifest, null, 2)}\n`);
	for (const file of [binary, ...files, await inspect(manifestName)]) {
		await fs.writeFile(path.join(root, `${file.name}.sha256`), `${file.sha256}  ${file.name}\n`);
	}
	return manifest;
}

if (import.meta.main) {
	const root = path.resolve(import.meta.dir, "../packages/coding-agent/binaries");
	const { version } = await Bun.file(path.resolve(import.meta.dir, "../packages/coding-agent/package.json")).json();
	for (const arch of ["x64", "arm64"] as const) {
		await createLinuxReleaseProvenance({ root, arch, version, commit: Bun.env.GITHUB_SHA ?? "", runId: Bun.env.GITHUB_RUN_ID ?? "", runAttempt: Bun.env.GITHUB_RUN_ATTEMPT ?? "", buildPlatform: `${process.platform}-${process.arch}` });
	}
}
