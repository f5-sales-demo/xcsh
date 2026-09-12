import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const evidenceRoot = join(root, "packages/coding-agent/test/evidence");
const expectedFingerprint = "ca9c5c03475c256d54a3d5b0edd0e06b78802dc7b56dd777652299df0fb2a98b";
const variants = [
	"60x20-dark-unicode",
	"60x20-dark-ascii",
	"60x20-light-unicode",
	"60x20-light-ascii",
	"80x24-dark-unicode",
	"80x24-dark-ascii",
	"80x24-light-unicode",
	"80x24-light-ascii",
	"100x32-dark-unicode",
	"100x32-dark-ascii",
	"100x32-light-unicode",
	"100x32-light-ascii",
	"140x40-dark-unicode",
	"140x40-dark-ascii",
	"140x40-light-unicode",
	"140x40-light-ascii",
] as const;

const matrices = [
	["terminal-memory-fast-final-v1", "terminal-memory-fast-v2"],
	["terminal-force-final-v1", "terminal-force-matrix-v2"],
	["terminal-route-mode-final-v1", "terminal-route-mode-v3"],
	["terminal-plan-mode-final-v1", "terminal-plan-mode-v3"],
	["terminal-publication-launcher-final-v1", "terminal-publication-launcher-v1"],
	["terminal-copy-clipboard-final-v1", "terminal-copy-clipboard"],
	["terminal-memory-actions-final-v1", "terminal-memory-actions-v1"],
	["terminal-manual-compaction-final-v1", "terminal-manual-compaction-v1"],
	["terminal-plugin-metadata-refresh-final-v1", "terminal-plugin-metadata-refresh-v1"],
	["terminal-background-transfer-final-v1", "terminal-background-transfer-v1"],
	["terminal-reviewed-exit-final-v1", "terminal-reviewed-exit-v1"],
	["terminal-browser-chrome-final-v1", "terminal-browser-chrome-v1"],
	["terminal-reports-final-v1", "terminal-reports-v2"],
	["terminal-foundation-login-model-final-v1", "terminal-foundation-login-model-v1"],
	["terminal-plugin-lifecycle-final-v1", "terminal-plugin-lifecycle-v2"],
	["terminal-settings-inventories-final-v1", "terminal-settings-inventories-v2"],
	["terminal-sessions-final-v1", "terminal-sessions-v1"],
	["terminal-resources-artifacts-final-v1", "terminal-resources-artifacts-v1"],
	["terminal-connections-final-v1", "terminal-connections-v1"],
] as const;

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function normalizeDynamicText(text: string): string {
	return text
		.replaceAll(/\/tmp\/xcsh-terminal-uat-[A-Za-z0-9]+/g, "/tmp/xcsh-terminal-uat-XXXXXX")
		.replaceAll(/20\d\d-\d\d-\d\dT\d\d[-:]\d\d[-:]\d\d[-.]\d+Z_[0-9a-f]+/g, "TIMESTAMP_SESSION")
		.replaceAll(/(?<![0-9a-f])[0-9a-f]{16}(?![0-9a-f])/g, "SESSION_ID");
}

const summaries: Array<Record<string, unknown>> = [];
for (const [directory, historicalDirectory] of matrices) {
	const matrixRoot = join(evidenceRoot, directory);
	const historicalRoot = join(evidenceRoot, historicalDirectory);
	const matrix = (await Bun.file(join(matrixRoot, "matrix.json")).json()) as {
		fixture?: string;
		complete?: boolean;
		runs?: Array<{ name: string; exitCode: number; passed: boolean; visualVerdict: string }>;
	};
	if (
		matrix.complete !== true ||
		matrix.runs?.length !== 16 ||
		matrix.runs.some(run => !run.passed || run.exitCode !== 0)
	)
		throw new Error(`Incomplete interaction matrix: ${directory}`);
	if (matrix.runs.some(run => !variants.includes(run.name as (typeof variants)[number])))
		throw new Error(`Unexpected variant in ${directory}`);

	const pngPaths = [...new Bun.Glob("*x*-*/evidence/*.png").scanSync({ cwd: matrixRoot })].sort();
	const jsonPaths = [...new Bun.Glob("*x*-*/evidence/*.json").scanSync({ cwd: matrixRoot })].sort();
	if (pngPaths.length === 0 || jsonPaths.length === 0)
		throw new Error(`Missing capture evidence in ${directory}: ${pngPaths.length} PNG, ${jsonPaths.length} JSON`);
	const receiptPngPaths = new Set(jsonPaths.map(path => path.replace(/\.json$/, ".png")));
	const missingReceiptPngs = [...receiptPngPaths].filter(path => !pngPaths.includes(path));
	if (missingReceiptPngs.length > 0)
		throw new Error(`Capture receipts without PNGs in ${directory}: ${missingReceiptPngs.join(", ")}`);
	const nonReceiptPngPaths = pngPaths.filter(path => !receiptPngPaths.has(path));
	if (nonReceiptPngPaths.length > 0)
		throw new Error(`Unexpected non-capture PNGs in ${directory}: ${nonReceiptPngPaths.join(", ")}`);

	for (const variant of variants) {
		const walkthrough = (await Bun.file(join(matrixRoot, variant, "walkthrough.json")).json()) as {
			fingerprint?: string;
			outcome?: { status?: string };
		};
		if (walkthrough.fingerprint !== expectedFingerprint || walkthrough.outcome?.status !== "passed")
			throw new Error(`Stale or failed walkthrough: ${directory}/${variant}`);
	}
	for (const jsonPath of jsonPaths) {
		const receipt = (await Bun.file(join(matrixRoot, jsonPath)).json()) as { fingerprint?: string };
		if (receipt.fingerprint !== expectedFingerprint)
			throw new Error(`Stale capture receipt: ${directory}/${jsonPath}`);
	}

	const contactRoot = join(matrixRoot, "contact-sheets");
	await mkdir(contactRoot, { recursive: true });
	const stateNames = [...new Set(pngPaths.map(path => basename(path)))].sort();
	for (const stateName of stateNames) {
		const ordered: string[] = [];
		for (const variant of variants) {
			const path = join(matrixRoot, variant, "evidence", stateName);
			if (await Bun.file(path).exists()) ordered.push(path);
		}
		const output = join(contactRoot, stateName);
		const montage = Bun.spawnSync([
			"montage",
			...ordered,
			"-background",
			"#666666",
			"-tile",
			"4x",
			"-geometry",
			"440x300+0+0",
			output,
		]);
		if (montage.exitCode !== 0)
			throw new Error(`Contact sheet failed for ${directory}/${stateName}: ${montage.stderr.toString()}`);
	}

	let exactPngMatches = 0;
	let normalizedTextMatches = 0;
	let changedText = 0;
	let missingHistorical = 0;
	const images: Array<Record<string, unknown>> = [];
	for (const pngPath of pngPaths) {
		const currentPath = join(matrixRoot, pngPath);
		const historicalPath = join(historicalRoot, pngPath);
		const currentBytes = await Bun.file(currentPath).bytes();
		const historicalExists = await Bun.file(historicalPath).exists();
		let comparison = "missing-historical";
		if (!historicalExists) missingHistorical++;
		else if (sha256(currentBytes) === sha256(await Bun.file(historicalPath).bytes())) {
			exactPngMatches++;
			comparison = "exact-png";
		} else {
			const currentTextPath = currentPath.replace(/\.png$/, ".txt");
			const historicalTextPath = historicalPath.replace(/\.png$/, ".txt");
			if (
				(await Bun.file(currentTextPath).exists()) &&
				(await Bun.file(historicalTextPath).exists()) &&
				normalizeDynamicText(await Bun.file(currentTextPath).text()) ===
					normalizeDynamicText(await Bun.file(historicalTextPath).text())
			) {
				normalizedTextMatches++;
				comparison = "normalized-text";
			} else {
				changedText++;
				comparison = "changed-text";
			}
		}
		images.push({
			path: pngPath,
			sha256: sha256(currentBytes),
			historicalComparison: comparison,
			receiptBacked: receiptPngPaths.has(pngPath),
		});
	}
	const summary = {
		directory,
		historicalDirectory,
		fixture: matrix.fixture ?? "memory-fast",
		fingerprint: expectedFingerprint,
		variants: matrix.runs.length,
		images: pngPaths.length,
		contactSheets: stateNames.length,
		exactPngMatches,
		normalizedTextMatches,
		changedText,
		missingHistorical,
		visualVerdict: "unexamined",
		imageInventory: images,
	};
	await Bun.write(join(matrixRoot, "visual-inventory.json"), `${JSON.stringify(summary, null, 2)}\n`);
	summaries.push({ ...summary, imageInventory: undefined });
}

console.log(JSON.stringify({ fingerprint: expectedFingerprint, matrices: summaries }, null, 2));
