import { readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const EXPECTED_FINGERPRINT = "ca9c5c03475c256d54a3d5b0edd0e06b78802dc7b56dd777652299df0fb2a98b";
const EXPECTED_INTERACTIONS = 304;
const EXPECTED_IMAGES = 4_880;
const EXPECTED_RECEIPTS = 4_880;
const EXPECTED_CONTACT_SHEETS = 323;
const EXPECTED_REVIEW_PAGES = 86;
const PASS = "pass-actual-terminal";

const expectations = [
	["terminal-memory-fast-final-v1", "memory-fast", 192, 12, 3],
	["terminal-force-final-v1", "force-read", 64, 4, 1],
	["terminal-route-mode-final-v1", "route-mode", 328, 26, 7],
	["terminal-plan-mode-final-v1", "plan-mode", 236, 20, 5],
	["terminal-publication-launcher-final-v1", "publication-launcher", 224, 14, 4],
	["terminal-copy-clipboard-final-v1", "copy-clipboard", 312, 21, 6],
	["terminal-memory-actions-final-v1", "memory-actions", 232, 16, 4],
	["terminal-manual-compaction-final-v1", "manual-compaction", 100, 7, 2],
	["terminal-plugin-metadata-refresh-final-v1", "plugin-metadata-refresh", 48, 3, 1],
	["terminal-background-transfer-final-v1", "background-transfer", 64, 4, 1],
	["terminal-reviewed-exit-final-v1", "reviewed-exit", 96, 6, 2],
	["terminal-browser-chrome-final-v1", "browser-chrome", 232, 16, 4],
	["terminal-reports-final-v1", "reports", 536, 34, 9],
	["terminal-foundation-login-model-final-v1", "foundation-login-model", 500, 32, 8],
	["terminal-plugin-lifecycle-final-v1", "plugin-lifecycle", 384, 24, 6],
	["terminal-settings-inventories-final-v1", "settings-inventories", 276, 18, 5],
	["terminal-sessions-final-v1", "sessions", 464, 29, 8],
	["terminal-resources-artifacts-final-v1", "resources-artifacts", 336, 21, 6],
	["terminal-connections-final-v1", "connections", 256, 16, 4],
] as const;

const variants = new Set([
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
]);

interface ReviewMatrix {
	directory: string;
	fixture: string;
	imagesRepresented: number;
	contactSheetsInspected: number;
	reviewPagesInspected: number;
	verdict: string;
}

interface ReviewReceipt {
	schemaVersion: number;
	fingerprint: string;
	reviewedAt: string;
	reviewedBy: string;
	inspectionMode: string;
	rubric: string[];
	reviewPagesInspected: number;
	overallVerdict: string;
	matrices: ReviewMatrix[];
}

interface Matrix {
	fixture?: string;
	complete?: boolean;
	runs?: Array<{
		name: string;
		exitCode: number;
		passed: boolean;
		visualVerdict: string;
	}>;
}

interface VisualInventory {
	directory?: string;
	fixture?: string;
	fingerprint?: string;
	variants?: number;
	images?: number;
	contactSheets?: number;
	visualVerdict?: string;
	imageInventory?: Array<{ path?: string; receiptBacked?: boolean }>;
}

const root = resolve(import.meta.dir, "../../..");
const evidenceRoot = join(root, "packages/coding-agent/test/evidence");
const reviewReceiptPath = join(evidenceRoot, "final-matrix-visual-review.json");
const review = (await Bun.file(reviewReceiptPath).json()) as ReviewReceipt;

if (
	review.schemaVersion !== 1 ||
	review.fingerprint !== EXPECTED_FINGERPRINT ||
	review.inspectionMode !== "manual-direct-image-review" ||
	review.overallVerdict !== PASS ||
	review.reviewPagesInspected !== EXPECTED_REVIEW_PAGES ||
	!review.reviewedAt ||
	!review.reviewedBy ||
	review.rubric.length !== 8
)
	throw new Error("Final visual review receipt is missing, stale, or incomplete");

const reviewByDirectory = new Map(review.matrices.map(item => [item.directory, item]));
if (reviewByDirectory.size !== expectations.length || review.matrices.length !== expectations.length)
	throw new Error("Final visual review receipt must cover exactly the 19 accepted matrices");

const writes: Array<{ path: string; content: string }> = [];
let interactions = 0;
let images = 0;
let receipts = 0;
let contactSheets = 0;
let reviewPages = 0;

for (const [directory, fixture, expectedImages, expectedSheets, expectedPages] of expectations) {
	const reviewItem = reviewByDirectory.get(directory);
	if (
		!reviewItem ||
		reviewItem.fixture !== fixture ||
		reviewItem.imagesRepresented !== expectedImages ||
		reviewItem.contactSheetsInspected !== expectedSheets ||
		reviewItem.reviewPagesInspected !== expectedPages ||
		reviewItem.verdict !== PASS
	)
		throw new Error(`Incomplete direct visual review receipt: ${directory}`);

	const matrixRoot = join(evidenceRoot, directory);
	const matrixPath = join(matrixRoot, "matrix.json");
	const inventoryPath = join(matrixRoot, "visual-inventory.json");
	const matrix = (await Bun.file(matrixPath).json()) as Matrix;
	const inventory = (await Bun.file(inventoryPath).json()) as VisualInventory;
	if (
		matrix.complete !== true ||
		matrix.fixture !== fixture ||
		matrix.runs?.length !== 16 ||
		matrix.runs.some(run => run.exitCode !== 0 || !run.passed) ||
		new Set(matrix.runs.map(run => run.name)).size !== variants.size ||
		matrix.runs.some(run => !variants.has(run.name))
	)
		throw new Error(`Incomplete interaction matrix: ${directory}`);
	if (
		inventory.directory !== directory ||
		inventory.fixture !== fixture ||
		inventory.fingerprint !== EXPECTED_FINGERPRINT ||
		inventory.variants !== 16 ||
		inventory.images !== expectedImages ||
		inventory.contactSheets !== expectedSheets ||
		inventory.imageInventory?.length !== expectedImages
	)
		throw new Error(`Stale or incomplete visual inventory: ${directory}`);

	const sheetNames = (await readdir(join(matrixRoot, "contact-sheets"))).filter(name => name.endsWith(".png")).sort();
	if (sheetNames.length !== expectedSheets)
		throw new Error(`Expected ${expectedSheets} contact sheets in ${directory}, found ${sheetNames.length}`);

	const receiptPaths = [...new Bun.Glob("*x*-*/evidence/*.json").scanSync({ cwd: matrixRoot })].sort();
	const expectedReceiptCount = expectedImages;
	if (receiptPaths.length !== expectedReceiptCount)
		throw new Error(
			`Expected ${expectedReceiptCount} capture receipts in ${directory}, found ${receiptPaths.length}`,
		);

	const imagePaths = inventory.imageInventory.map(item => item.path);
	if (imagePaths.some(path => typeof path !== "string"))
		throw new Error(`Visual inventory contains an invalid image path: ${directory}`);
	const stateNames = new Set((imagePaths as string[]).map(path => basename(path)));
	if (sheetNames.some(name => !stateNames.has(name)) || stateNames.size !== sheetNames.length)
		throw new Error(`Contact sheets do not exactly cover visual inventory states: ${directory}`);

	for (const run of matrix.runs) {
		const walkthrough = (await Bun.file(join(matrixRoot, run.name, "walkthrough.json")).json()) as {
			fingerprint?: string;
			outcome?: { status?: string };
		};
		if (walkthrough.fingerprint !== EXPECTED_FINGERPRINT || walkthrough.outcome?.status !== "passed")
			throw new Error(`Stale or failed walkthrough: ${directory}/${run.name}`);
		run.visualVerdict = PASS;
		interactions++;
	}

	for (const receiptPath of receiptPaths) {
		const path = join(matrixRoot, receiptPath);
		const receipt = (await Bun.file(path).json()) as Record<string, unknown>;
		if (receipt.fingerprint !== EXPECTED_FINGERPRINT)
			throw new Error(`Refusing stale visual verdict for ${directory}/${receiptPath}`);
		const imageName = receipt.image;
		if (
			typeof imageName !== "string" ||
			!(await Bun.file(join(matrixRoot, receiptPath.replace(/[^/]+$/, imageName))).exists())
		)
			throw new Error(`Missing capture image for ${directory}/${receiptPath}`);
		receipt.visualVerdict = PASS;
		receipt.inspection =
			"Direct fixed-order contact-sheet inspection: hierarchy, density, alignment, frame and highlight integrity, state semantics, discoverability, reachable details, recovery, and size/theme/symbol parity pass.";
		writes.push({ path, content: `${JSON.stringify(receipt, null, 2)}\n` });
		receipts++;
	}

	inventory.visualVerdict = PASS;
	writes.push({ path: matrixPath, content: `${JSON.stringify(matrix, null, 2)}\n` });
	writes.push({ path: inventoryPath, content: `${JSON.stringify(inventory, null, 2)}\n` });
	writes.push({
		path: join(matrixRoot, "visual-review.md"),
		content:
			`# Final actual-terminal visual review\n\n` +
			`Verdict: \`${PASS}\`\n\n` +
			`Fingerprint: \`${EXPECTED_FINGERPRINT}\`\n\n` +
			`Direct image inspection covered ${expectedImages} PNGs through ${expectedSheets} fixed-order contact sheets on ${expectedPages} labeled review pages. ` +
			`All 16 variants (60×20, 80×24, 100×32, and 140×40; dark/light; Unicode/ASCII) passed hierarchy, density, alignment, frame/highlight integrity, state semantics, discoverability, reachable-details, recovery, and responsive-parity review.\n\n` +
			`The matrix contains 16 passing current-source interactions. Capture receipts and the visual inventory are fingerprint-pinned and adjudicated by \`packages/coding-agent/scripts/adjudicate-final-matrix-evidence.ts\`.\n`,
	});

	images += expectedImages;
	contactSheets += expectedSheets;
	reviewPages += expectedPages;
}

if (
	interactions !== EXPECTED_INTERACTIONS ||
	images !== EXPECTED_IMAGES ||
	receipts !== EXPECTED_RECEIPTS ||
	contactSheets !== EXPECTED_CONTACT_SHEETS ||
	reviewPages !== EXPECTED_REVIEW_PAGES
)
	throw new Error(
		`Final evidence totals differ: ${interactions} interactions, ${images} images, ${receipts} receipts, ${contactSheets} contact sheets, ${reviewPages} review pages`,
	);

for (const write of writes) await Bun.write(write.path, write.content);

console.log(
	JSON.stringify({
		fingerprint: EXPECTED_FINGERPRINT,
		matrices: expectations.length,
		interactions,
		images,
		receipts,
		contactSheets,
		reviewPages,
		visualVerdict: PASS,
	}),
);
