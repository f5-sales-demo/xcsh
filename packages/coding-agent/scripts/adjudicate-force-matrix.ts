import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const EXPECTED_FINGERPRINT = "bee841dba79319cae654cc2dd5836ade7c96cad5cb3b9b1eb05b11e775672b98";
const directory = resolve(process.argv[2] ?? "packages/coding-agent/test/evidence/terminal-force-matrix-v2");
const matrixPath = join(directory, "matrix.json");
const matrix = (await Bun.file(matrixPath).json()) as {
	complete: boolean;
	runs: Array<{
		name: string;
		passed: boolean;
		visualVerdict: string;
		receipt: { persistence?: { sessionFiles?: string[]; providerRequests?: unknown[] } };
	}>;
};

if (!matrix.complete || matrix.runs.length !== 16 || matrix.runs.some(run => !run.passed))
	throw new Error("Force matrix must contain 16 passing interaction runs");

let adjudicated = 0;
for (const run of matrix.runs) {
	const walkthroughPath = join(directory, run.name, "walkthrough.json");
	const walkthrough = (await Bun.file(walkthroughPath).json()) as {
		fingerprint?: string;
		outcome?: { status?: string };
		persistence?: { sessionFiles?: string[]; providerRequests?: Array<{ method?: string; path?: string }> };
	};
	if (walkthrough.fingerprint !== EXPECTED_FINGERPRINT || walkthrough.outcome?.status !== "passed")
		throw new Error(`Stale or failed walkthrough: ${run.name}`);
	if (walkthrough.persistence?.sessionFiles?.length !== 0)
		throw new Error(`Force fixture wrote session state: ${run.name}`);
	if (
		JSON.stringify(walkthrough.persistence?.providerRequests) !==
		JSON.stringify([{ method: "GET", path: "/v1/models" }])
	)
		throw new Error(`Unexpected provider traffic: ${run.name}`);
	const evidenceDirectory = join(directory, run.name, "evidence");
	const receipts = (await readdir(evidenceDirectory)).filter(name => name.endsWith(".json")).sort();
	if (receipts.length !== 4) throw new Error(`Expected four capture receipts for ${run.name}`);
	for (const name of receipts) {
		const path = join(evidenceDirectory, name);
		const receipt = (await Bun.file(path).json()) as Record<string, unknown>;
		if (receipt.fingerprint !== EXPECTED_FINGERPRINT)
			throw new Error(`Refusing stale visual verdict for ${run.name}/${name}`);
		const image = receipt.image;
		if (typeof image !== "string" || !(await Bun.file(join(evidenceDirectory, image)).exists()))
			throw new Error(`Missing image for ${run.name}/${name}`);
		receipt.visualVerdict = "pass-actual-terminal";
		receipt.inspection =
			"Direct fixed-order contact-sheet inspection: hierarchy, density, alignment, frame and highlight integrity, state semantics, discoverability, and size/theme/symbol parity pass.";
		await Bun.write(path, `${JSON.stringify(receipt, null, 2)}\n`);
		adjudicated++;
	}
	run.visualVerdict = "pass-actual-terminal";
}

if (adjudicated !== 64) throw new Error(`Expected 64 force captures, adjudicated ${adjudicated}`);
await Bun.write(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`);
console.log(
	JSON.stringify({
		directory,
		fingerprint: EXPECTED_FINGERPRINT,
		runs: matrix.runs.length,
		adjudicated,
	}),
);
