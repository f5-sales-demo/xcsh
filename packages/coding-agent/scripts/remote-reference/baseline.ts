import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface ReferenceBaseline {
	tag: string;
	tagObject: string;
	sourceCommit: string;
	version: string;
	files: Record<string, string>;
}

const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;

export function validateReferenceBaseline(value: unknown, requestedVersion: string): ReferenceBaseline {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Reference baseline is malformed");
	const baseline = value as Partial<ReferenceBaseline>;
	if (
		baseline.version !== requestedVersion ||
		baseline.tag !== `rust-v${requestedVersion}` ||
		!SHA40.test(baseline.tagObject ?? "") ||
		!SHA40.test(baseline.sourceCommit ?? "") ||
		!baseline.files ||
		typeof baseline.files !== "object" ||
		Array.isArray(baseline.files) ||
		Object.keys(baseline.files).length === 0 ||
		Object.entries(baseline.files).some(([file, hash]) => !file || !SHA64.test(hash))
	)
		throw new Error("Reference baseline is malformed or incomplete");
	return baseline as ReferenceBaseline;
}

export async function loadReferenceBaseline(version: string): Promise<ReferenceBaseline> {
	if (version !== "0.153.4" && version !== "0.154.0")
		throw new Error("Explicit reference baseline must be 0.153.4 or 0.154.0");
	const value = JSON.parse(await readFile(join(import.meta.dir, `source-manifest-${version}.json`), "utf8"));
	return validateReferenceBaseline(value, version);
}

function git(root: string, ...args: string[]): string {
	const result = Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) throw new Error("Reference source must be the exact tagged Git checkout");
	return result.stdout.toString().trim();
}

export function verifyReferenceCheckout(root: string, baseline: ReferenceBaseline): void {
	if (git(root, "rev-parse", "HEAD") !== baseline.sourceCommit) throw new Error("Reference source commit differs");
	if (git(root, "rev-parse", `refs/tags/${baseline.tag}`) !== baseline.tagObject)
		throw new Error("Reference tag object differs");
	if (git(root, "rev-parse", `${baseline.tag}^{}`) !== baseline.sourceCommit)
		throw new Error("Reference tag does not peel to the pinned commit");
}

export async function verifyReferenceFiles(root: string, baseline: ReferenceBaseline): Promise<void> {
	for (const [file, expected] of Object.entries(baseline.files)) {
		const actual = createHash("sha256")
			.update(await readFile(join(root, file)))
			.digest("hex");
		if (actual !== expected) throw new Error(`Reference source differs from the pinned baseline: ${file}`);
	}
}

export async function verifyArtifactHash(artifact: string, expected: string): Promise<string> {
	if (!SHA64.test(expected)) throw new Error("Expected artifact SHA-256 must be 64 lowercase hex characters");
	const actual = createHash("sha256")
		.update(await readFile(artifact))
		.digest("hex");
	if (actual !== expected) throw new Error("Reference artifact SHA-256 differs");
	return actual;
}
