import { expect, test } from "bun:test";

const AUDITED_TOP_LEVEL_COMMANDS = [
	"/agents",
	"/apply",
	"/background",
	"/branch",
	"/browser",
	"/btw",
	"/changelog",
	"/chrome",
	"/compact",
	"/context",
	"/copy",
	"/create",
	"/debug",
	"/delete",
	"/describe",
	"/diff",
	"/dump",
	"/exit",
	"/export",
	"/extensions",
	"/fast",
	"/force",
	"/fork",
	"/get",
	"/handoff",
	"/hotkeys",
	"/jobs",
	"/login",
	"/logout",
	"/manifest",
	"/mcp",
	"/media",
	"/memory",
	"/model",
	"/move",
	"/new",
	"/open",
	"/plan",
	"/plugin",
	"/quit",
	"/reload-plugins",
	"/rename",
	"/resume",
	"/route",
	"/session",
	"/settings",
	"/share",
	"/ssh",
	"/tools",
	"/tree",
	"/usage",
];

const ledgerFile = new URL("./evidence/slash-command-parity-ledger.json", import.meta.url);
const discoveryReceiptsFile = new URL(
	"./evidence/slash-command-discovery-differential-v1/receipts.json",
	import.meta.url,
);
const openCancelReceiptsFile = new URL(
	"./evidence/slash-command-open-cancel-differential-v1/receipts.json",
	import.meta.url,
);
const allSurfaceOpenCancelReceiptsFile = new URL(
	"./evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
	import.meta.url,
);
const allSurfaceOpenCancelRetryReceiptsFile = new URL(
	"./evidence/slash-command-all-surfaces-open-cancel-differential-v1/retry-receipts.json",
	import.meta.url,
);
const handlerReceiptsFile = new URL("./evidence/slash-command-handler-differential-v1/receipt.json", import.meta.url);
const forceReceiptsFile = new URL("./evidence/force-differential-v1/receipt.json", import.meta.url);
const fastReceiptsFile = new URL("./evidence/fast-differential-v1/receipts.json", import.meta.url);
const routeReceiptsFile = new URL("./evidence/route-differential-v1/receipts.json", import.meta.url);
const planReceiptsFile = new URL("./evidence/plan-differential-v1/receipts.json", import.meta.url);
const mediaReceiptsFile = new URL("./evidence/media-differential-v1/receipts.json", import.meta.url);
const clientResourcesReceiptsFile = new URL(
	"./evidence/client-resources-differential-v1/receipt.json",
	import.meta.url,
);
const resourceReviewReceiptsFile = new URL("./evidence/resource-review-differential-v1/receipt.json", import.meta.url);
const settingsNavigationReceiptsFile = new URL(
	"./evidence/settings-navigation-differential-v1/receipt.json",
	import.meta.url,
);
const fullCodingAgentReceiptsFile = new URL(
	"./evidence/coding-agent-test-differential-v1/receipt.json",
	import.meta.url,
);

interface ParityEntry {
	command: string;
	baseline: { aliases: string[]; subcommands: Array<{ name: string }> } | null;
	current: { aliases: string[]; subcommands: Array<{ name: string }> } | null;
	behaviorClassification: string;
	surfaceClassifications: Record<string, string>;
	baselineReceipts: string[];
	currentReceipts: string[];
	correctingTests: string[];
}

interface DiscoverySideReceipt {
	candidate: "published-v21.24.4" | "pre-fix-e68d757";
	commit: string;
	startup: "ready" | "failed";
	surfaces: Array<{ surface: string; expectedLabel: string; reachable: boolean; viewport: string }>;
}

function inventorySurfaces(entries: ParityEntry[], side: "baseline" | "current"): string[] {
	return entries
		.flatMap(entry => {
			const snapshot = entry[side];
			if (!snapshot) return [];
			return [
				entry.command,
				...snapshot.aliases.map(alias => `/${alias}`),
				...snapshot.subcommands.map(subcommand => `${entry.command} ${subcommand.name}`),
			];
		})
		.toSorted();
}

test("differential slash-command ledger is source-pinned and complete", async () => {
	const ledger = (await Bun.file(ledgerFile).json()) as {
		schemaVersion: number;
		status: string;
		baseline: { version: string; commit: string };
		current: { commit: string };
		differentialReceipts: Array<{ path: string; kind: string; limitation: string }>;
		candidateReceipts: Array<{ path: string; kind: string; limitation: string }>;
		responsiveMatrix: { expectedVariants: number };
		entries: ParityEntry[];
	};
	expect(ledger.schemaVersion).toBe(1);
	expect(ledger.status).toBe("complete");
	expect(ledger.baseline).toEqual({
		version: "v21.24.4",
		commit: "0c6d27e4afacc42b598478d1fba532ef1eab9204",
	});
	expect(ledger.current.commit).toBe("e68d757fa7ebf6f6e5b36d52138e99712c565065");
	expect(ledger.responsiveMatrix.expectedVariants).toBe(16);
	expect(ledger.differentialReceipts).toEqual([
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/slash-command-discovery-differential-v1/receipts.json",
			kind: "interactive-discovery-only",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
			kind: "interactive-all-surfaces-open-cancel-only",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/retry-receipts.json",
			kind: "interactive-all-surfaces-open-cancel-only-retry",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/resource-cli-differential-v1/receipt.json",
			kind: "resource-cli-contract-differential",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/client-resources-differential-v1/receipt.json",
			kind: "mcp-client-resource-contract-differential",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/resource-review-differential-v1/receipt.json",
			kind: "interactive-resource-review-differential",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/settings-navigation-differential-v1/receipt.json",
			kind: "interactive-settings-navigation-differential",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/report-runtime-keyboard-differential-v1/receipts.json",
			kind: "interactive-report-runtime-keyboard-differential",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/media-differential-v1/receipts.json",
			kind: "interactive-top-level-open-cancel-only",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/background-keyboard-differential-v1/receipts.json",
			kind: "interactive-top-level-open-cancel-only",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/slash-command-handler-differential-v1/receipt.json",
			kind: "direct-slash-command-handler-differential",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/force-differential-v1/receipt.json",
			kind: "interactive-force-differential",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/fast-differential-v1/receipts.json",
			kind: "interactive-fast-command-differential",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/route-differential-v1/receipts.json",
			kind: "interactive-route-command-differential",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/plan-differential-v1/receipts.json",
			kind: "interactive-plan-command-differential",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/compact-differential-v1/receipts.json",
			kind: "interactive-compact-empty-session-differential",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/compact-seeded-differential-v1/receipt.json",
			kind: "interactive-compact-seeded-differential",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/foundation-login-model-differential-v1/receipts.json",
			kind: "interactive-login-model-open-cancel-differential",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/reload-plugins-differential-v1/receipts.json",
			kind: "interactive-reload-plugins-differential",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/new-differential-v1/receipts.json",
			kind: "interactive-new-session-differential",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/fork-differential-v1/receipts.json",
			kind: "interactive-fork-differential",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/coding-agent-test-differential-v1/receipt.json",
			kind: "full-coding-agent-test-differential",
		}),
	]);
	expect(ledger.entries).toHaveLength(51);
	expect(ledger.candidateReceipts).toEqual([
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/working-resource-uat-v1/receipt.json",
			kind: "working-tree-resource-terminal-uat",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/terminal-settings-inventories-final-v1/matrix.json",
			kind: "working-tree-responsive-matrix",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/working-smoke-v1/receipt.json",
			kind: "working-tree-cli-smoke",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/working-types-v1/receipt.json",
			kind: "working-tree-typescript-tools",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/working-full-workspace-test-v1/receipt.json",
			kind: "working-tree-full-workspace-test",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/working-full-workspace-test-v2/receipt.json",
			kind: "working-tree-full-workspace-test",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/working-full-workspace-test-v3/receipt.json",
			kind: "working-tree-full-workspace-test",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/working-full-workspace-test-v4/receipt.json",
			kind: "working-tree-full-workspace-test",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/terminal-memory-fast-final-v1/matrix.json",
			kind: "working-tree-fast-responsive-matrix",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/terminal-route-mode-final-v1/matrix.json",
			kind: "working-tree-route-responsive-matrix",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/terminal-plan-mode-final-v1/matrix.json",
			kind: "working-tree-plan-responsive-matrix",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/terminal-plugin-metadata-refresh-final-v1/matrix.json",
			kind: "working-tree-plugin-metadata-responsive-matrix",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/terminal-sessions-final-v1/matrix.json",
			kind: "working-tree-sessions-responsive-matrix",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/terminal-reports-final-v1/matrix.json",
			kind: "working-tree-report-runtime-responsive-matrix",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/terminal-background-transfer-final-v1/matrix.json",
			kind: "working-tree-background-transfer-responsive-matrix",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/terminal-reviewed-exit-final-v1/matrix.json",
			kind: "working-tree-reviewed-exit-responsive-matrix",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/terminal-memory-actions-final-v1/matrix.json",
			kind: "working-tree-memory-actions-responsive-matrix",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/terminal-foundation-login-model-final-v1/matrix.json",
			kind: "working-tree-foundation-login-model-responsive-matrix",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/terminal-browser-chrome-final-v1/matrix.json",
			kind: "working-tree-browser-chrome-responsive-matrix",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/terminal-copy-clipboard-final-v1/matrix.json",
			kind: "working-tree-copy-clipboard-responsive-matrix",
		}),
		expect.objectContaining({
			path: "packages/coding-agent/test/evidence/terminal-publication-launcher-final-v1/matrix.json",
			kind: "working-tree-publication-launcher-responsive-matrix",
		}),
	]);
	for (const receipt of ledger.candidateReceipts) expect(receipt.limitation).toContain("cannot");
	const responsiveMatrices = ledger.candidateReceipts.filter(receipt => receipt.kind.includes("responsive-matrix"));
	expect(responsiveMatrices).toHaveLength(14);
	for (const receipt of responsiveMatrices) {
		const relativePath = receipt.path.replace("packages/coding-agent/test/", "./");
		const matrix = (await Bun.file(new URL(relativePath, import.meta.url)).json()) as {
			complete: boolean;
			runs: Array<{
				exitCode: number;
				passed: boolean;
				visualVerdict: string;
			}>;
		};
		expect(matrix.complete).toBe(true);
		expect(matrix.runs).toHaveLength(16);
		for (const run of matrix.runs) {
			expect(run.exitCode).toBe(0);
			expect(run.passed).toBe(true);
			expect(run.visualVerdict).toBe("pass-actual-terminal");
		}
	}
	expect(new Set(ledger.entries.map(entry => entry.command)).size).toBe(51);
	expect(ledger.entries.map(entry => entry.command).toSorted()).toEqual(AUDITED_TOP_LEVEL_COMMANDS);
});

test("pending differential rows cannot masquerade as parity evidence", async () => {
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: ParityEntry[] };
	for (const entry of ledger.entries) {
		if (entry.behaviorClassification === "pending-differential-uat") {
			expect(entry.baselineReceipts).toEqual([]);
			expect(entry.currentReceipts).toEqual([]);
		}
		const expectedSurfaces = [
			...[...new Set([...(entry.baseline?.aliases ?? []), ...(entry.current?.aliases ?? [])])].map(
				alias => `/${alias}`,
			),
			...[
				...new Set(
					[...(entry.baseline?.subcommands ?? []), ...(entry.current?.subcommands ?? [])].map(item => item.name),
				),
			].map(subcommand => `${entry.command} ${subcommand}`),
		].sort();
		expect(Object.keys(entry.surfaceClassifications).sort()).toEqual(expectedSurfaces);
	}
});

test("media preserves every playback subcommand and records additive bare-command guidance", async () => {
	const receipt = (await Bun.file(mediaReceiptsFile).json()) as {
		schemaVersion: number;
		kind: string;
		keyboardProbe: boolean;
		baseline: {
			commit: string;
			surfaces: Array<{ surface: string; entered: boolean; escapeSent: boolean; openedViewport: string }>;
		};
		current: {
			commit: string;
			surfaces: Array<{ surface: string; entered: boolean; escapeSent: boolean; openedViewport: string }>;
		};
	};
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: ParityEntry[] };
	expect(receipt).toMatchObject({
		schemaVersion: 1,
		kind: "interactive-top-level-open-cancel-only",
		keyboardProbe: true,
		baseline: { commit: "0c6d27e4afacc42b598478d1fba532ef1eab9204" },
		current: { commit: "e68d757fa7ebf6f6e5b36d52138e99712c565065" },
	});
	for (const side of [receipt.baseline, receipt.current]) {
		for (const surface of side.surfaces) {
			expect(surface.entered).toBe(true);
			expect(surface.escapeSent).toBe(true);
		}
		for (const action of ["/media play", "/media pause", "/media stop"]) {
			expect(side.surfaces.find(surface => surface.surface === action)?.openedViewport).toContain(
				"No media is available in this transcript.",
			);
		}
	}
	expect(receipt.baseline.surfaces.find(surface => surface.surface === "/media")?.openedViewport).not.toContain(
		"Usage: /media",
	);
	expect(receipt.current.surfaces.find(surface => surface.surface === "/media")?.openedViewport).toContain(
		"Usage: /media play|pause|stop <latest|media-id>",
	);
	expect(ledger.entries.find(entry => entry.command === "/media")).toMatchObject({
		behaviorClassification: "additive",
		surfaceClassifications: {
			"/media play": "unchanged",
			"/media pause": "unchanged",
			"/media stop": "unchanged",
		},
		baselineReceipts: ["packages/coding-agent/test/evidence/media-differential-v1/receipts.json"],
		currentReceipts: ["packages/coding-agent/test/evidence/media-differential-v1/receipts.json"],
		correctingTests: ["packages/coding-agent/test/media-message-component.test.ts"],
	});
});

test("btw records its intentional explicit-interrupt safety redesign", async () => {
	const matrix = (await Bun.file(
		new URL("./evidence/terminal-reports-final-v1/matrix.json", import.meta.url),
	).json()) as {
		complete: boolean;
		fixture: string;
		runs: Array<{
			exitCode: number;
			passed: boolean;
			receipt: {
				persistence: {
					btwRequestsChangedTranscript: boolean;
					btwRequests: number;
					mainConversationReopened: boolean;
				};
			};
		}>;
	};
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: ParityEntry[] };
	expect(matrix).toMatchObject({ complete: true, fixture: "reports" });
	expect(matrix.runs).toHaveLength(16);
	for (const run of matrix.runs) {
		expect(run).toMatchObject({ exitCode: 0, passed: true });
		expect(run.receipt.persistence).toMatchObject({
			btwRequestsChangedTranscript: false,
			btwRequests: 4,
			mainConversationReopened: true,
		});
	}
	expect(ledger.entries.find(entry => entry.command === "/btw")).toMatchObject({
		behaviorClassification: "intentional-safety-addition",
		baselineReceipts: ["packages/coding-agent/test/evidence/slash-command-handler-differential-v1/receipt.json"],
		currentReceipts: ["packages/coding-agent/test/evidence/slash-command-handler-differential-v1/receipt.json"],
		correctingTests: ["packages/coding-agent/test/modes/controllers/btw-controller.test.ts"],
	});
});

test("background records its intentional transfer-safety redesign for the command and alias", async () => {
	const matrix = (await Bun.file(
		new URL("./evidence/terminal-background-transfer-final-v1/matrix.json", import.meta.url),
	).json()) as {
		complete: boolean;
		fixture: string;
		runs: Array<{
			exitCode: number;
			passed: boolean;
			receipt: {
				persistence: {
					providerPosts: number;
					nothingCancelledClaimVerified: boolean;
					posixStopAndBgResumeVerified: boolean;
					reopenedCompletedResponse: boolean;
				};
			};
		}>;
	};
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: ParityEntry[] };
	expect(matrix).toMatchObject({ complete: true, fixture: "background-transfer" });
	expect(matrix.runs).toHaveLength(16);
	for (const run of matrix.runs) {
		expect(run).toMatchObject({ exitCode: 0, passed: true });
		expect(run.receipt.persistence).toMatchObject({
			providerPosts: 1,
			nothingCancelledClaimVerified: true,
			posixStopAndBgResumeVerified: true,
			reopenedCompletedResponse: true,
		});
	}
	expect(ledger.entries.find(entry => entry.command === "/background")).toMatchObject({
		behaviorClassification: "intentional-safety-addition",
		surfaceClassifications: { "/bg": "intentional-safety-addition" },
		baselineReceipts: ["packages/coding-agent/test/evidence/background-keyboard-differential-v1/receipts.json"],
		currentReceipts: ["packages/coding-agent/test/evidence/background-keyboard-differential-v1/receipts.json"],
		correctingTests: ["packages/coding-agent/test/input-controller-background.test.ts"],
	});
});

test("exit and quit record their shared intentional reviewed-shutdown safety change", async () => {
	const matrix = (await Bun.file(
		new URL("./evidence/terminal-reviewed-exit-final-v1/matrix.json", import.meta.url),
	).json()) as {
		complete: boolean;
		fixture: string;
		runs: Array<{
			exitCode: number;
			passed: boolean;
			receipt: {
				persistence: {
					providerPosts: number;
					noWriteBeforeReview: boolean;
					cancelLeftBytesUnchanged: boolean;
					exitAndQuitSharedReview: boolean;
					confirmedExitCode: number;
					reopenedSubmittedMessage: boolean;
				};
			};
		}>;
	};
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: ParityEntry[] };
	expect(matrix).toMatchObject({ complete: true, fixture: "reviewed-exit" });
	expect(matrix.runs).toHaveLength(16);
	for (const run of matrix.runs) {
		expect(run).toMatchObject({ exitCode: 0, passed: true });
		expect(run.receipt.persistence).toMatchObject({
			providerPosts: 1,
			noWriteBeforeReview: true,
			cancelLeftBytesUnchanged: true,
			exitAndQuitSharedReview: true,
			confirmedExitCode: 0,
			reopenedSubmittedMessage: true,
		});
	}
	for (const command of ["/exit", "/quit"]) {
		expect(ledger.entries.find(entry => entry.command === command)).toMatchObject({
			behaviorClassification: "intentional-safety-addition",
			baselineReceipts: [
				"packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
			],
			currentReceipts: [
				"packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
			],
			correctingTests: ["packages/coding-agent/test/slash-commands/exit.test.ts"],
		});
	}
});

test("memory records reviewed destructive and persistent actions while retaining its view surface", async () => {
	const matrix = (await Bun.file(
		new URL("./evidence/terminal-memory-actions-final-v1/matrix.json", import.meta.url),
	).json()) as {
		complete: boolean;
		fixture: string;
		runs: Array<{
			exitCode: number;
			passed: boolean;
			receipt: {
				persistence: {
					cancelledClearRevisionUnchanged: boolean;
					clearRemovedAllRecordsAndFiles: boolean;
					cancelledEnqueueRevisionUnchanged: boolean;
					confirmedQueueState: string;
					resetRemovedQueuedRequestAndConcurrentArtifact: boolean;
					final: { threads: number; outputs: number; jobs: number; files: number };
				};
			};
		}>;
	};
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: ParityEntry[] };
	expect(matrix).toMatchObject({ complete: true, fixture: "memory-actions" });
	expect(matrix.runs).toHaveLength(16);
	for (const run of matrix.runs) {
		expect(run).toMatchObject({ exitCode: 0, passed: true });
		expect(run.receipt.persistence).toMatchObject({
			cancelledClearRevisionUnchanged: true,
			clearRemovedAllRecordsAndFiles: true,
			cancelledEnqueueRevisionUnchanged: true,
			resetRemovedQueuedRequestAndConcurrentArtifact: true,
			final: { threads: 0, outputs: 0, jobs: 0, files: 0 },
		});
		expect(run.receipt.persistence.confirmedQueueState).toContain("pending");
	}
	expect(ledger.entries.find(entry => entry.command === "/memory")).toMatchObject({
		behaviorClassification: "intentional-safety-addition",
		surfaceClassifications: {
			"/memory view": "intentional-redesign",
			"/memory clear": "intentional-safety-addition",
			"/memory reset": "intentional-safety-addition",
			"/memory enqueue": "intentional-safety-addition",
			"/memory rebuild": "intentional-safety-addition",
		},
		baselineReceipts: [
			"packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
		],
		currentReceipts: [
			"packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
		],
		correctingTests: ["packages/coding-agent/test/modes/controllers/command-controller-memory.test.ts"],
	});
});

test("the confirmed settings regression is tracked separately from the pre-existing editor gap", async () => {
	const ledger = (await Bun.file(ledgerFile).json()) as {
		preExistingGaps: Array<{ id: string; classification: string; note: string }>;
		entries: ParityEntry[];
	};
	const settings = ledger.entries.find(entry => entry.command === "/settings");
	expect(settings?.behaviorClassification).toBe("confirmed-regression");
	expect(settings?.correctingTests).toHaveLength(2);
	expect(settings?.baselineReceipts).toEqual([
		"packages/coding-agent/test/evidence/settings-navigation-differential-v1/receipt.json",
	]);
	expect(settings?.currentReceipts).toEqual([
		"packages/coding-agent/test/evidence/settings-navigation-differential-v1/receipt.json",
	]);
	expect(ledger.preExistingGaps).toContainEqual({
		id: "settings-status-line-segment-editor",
		classification: "pre-existing-feature-gap",
		note: "The deleted editor was already unreachable in v21.24.4 and is excluded from refactor parity remediation.",
	});
});

test("settings navigation differential preserves the published contract and records the pre-fix loss", async () => {
	const receipt = (await Bun.file(settingsNavigationReceiptsFile).json()) as {
		schemaVersion: number;
		kind: string;
		baseline: { commit: string; startupError?: string; steps: Record<string, string>; configBytesPreserved: boolean };
		current: { commit: string; startupError?: string; steps: Record<string, string>; configBytesPreserved: boolean };
	};
	expect(receipt).toMatchObject({ schemaVersion: 1, kind: "interactive-settings-navigation-differential" });
	expect(receipt.baseline).toMatchObject({
		commit: "0c6d27e4afacc42b598478d1fba532ef1eab9204",
		configBytesPreserved: false,
	});
	expect(receipt.current).toMatchObject({
		commit: "e68d757fa7ebf6f6e5b36d52138e99712c565065",
		configBytesPreserved: true,
	});
	expect(receipt.baseline).not.toHaveProperty("startupError");
	expect(receipt.current).not.toHaveProperty("startupError");
	expect(receipt.baseline.steps.open).toContain("🎨 Appearance");
	expect(receipt.baseline.steps.right).toContain("Thinking Level");
	expect(receipt.baseline.steps.space).toContain("Enter to select");
	expect(receipt.current.steps.open).toContain("🎨 Appearance");
	expect(receipt.current.steps.right).toBe(receipt.current.steps.open);
	expect(receipt.current.steps.space).toBe(receipt.current.steps.open);
	expect(receipt.current.steps.enter).toContain("Choose a draft value");
});

test("the confirmed manifest canonical-parent regression retains its differential receipt and correcting test", async () => {
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: ParityEntry[] };
	const manifest = ledger.entries.find(entry => entry.command === "/manifest");
	expect(manifest).toMatchObject({
		behaviorClassification: "confirmed-regression",
		baselineReceipts: ["packages/coding-agent/test/evidence/resource-review-differential-v1/receipt.json"],
		currentReceipts: ["packages/coding-agent/test/evidence/resource-review-differential-v1/receipt.json"],
		correctingTests: ["packages/coding-agent/test/slash-commands/resource-commands-review.test.ts"],
	});
});

test("source-only additions are explicit and no alias or subcommand is silently removed", async () => {
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: ParityEntry[] };
	const classifications = Object.fromEntries(
		ledger.entries.flatMap(entry => Object.entries(entry.surfaceClassifications)),
	);
	expect(classifications["/browser status"]).toBe("additive");
	expect(classifications["/context link"]).toBe("additive");
	expect(classifications["/context unlink"]).toBe("additive");
	expect(Object.values(classifications)).not.toContain("removed-unapproved");
});

test("direct handler differential receipt remains pinned and distinguishes the force safety addition", async () => {
	const receipt = (await Bun.file(handlerReceiptsFile).json()) as {
		schemaVersion: number;
		kind: string;
		baseline: { commit: string; passed: number; failed: number };
		preFix: { commit: string; passed: number; failed: number };
		observedDelta: { command: string; classification: string };
	};
	expect(receipt.schemaVersion).toBe(1);
	expect(receipt.kind).toBe("direct-slash-command-handler-differential");
	expect(receipt.baseline).toMatchObject({
		commit: "0c6d27e4afacc42b598478d1fba532ef1eab9204",
		passed: 34,
		failed: 0,
	});
	expect(receipt.preFix).toMatchObject({
		commit: "e68d757fa7ebf6f6e5b36d52138e99712c565065",
		passed: 37,
		failed: 0,
	});
	expect(receipt.observedDelta).toMatchObject({
		command: "/force",
		classification: "intentional-safety-addition-pending-full-interactive-uat",
	});
});

test("interactive force differential completes the intentional safety-addition classification", async () => {
	const receipt = (await Bun.file(forceReceiptsFile).json()) as {
		schemaVersion: number;
		kind: string;
		baseline: {
			commit: string;
			emptyInvocation: { selectorOpened: boolean; sessionFilesBefore: number; sessionFilesAfterCancel: number };
			explicitRead: { sessionFilesBefore: number; sessionFilesAfter: number; viewport: string };
		};
		preFix: {
			commit: string;
			emptyInvocation: { selectorOpened: boolean; sessionFilesBefore: number; sessionFilesAfterCancel: number };
			explicitRead: { sessionFilesBefore: number; sessionFilesAfter: number; viewport: string };
		};
		classification: string;
	};
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: ParityEntry[] };
	expect(receipt).toMatchObject({ schemaVersion: 1, kind: "interactive-force-differential" });
	expect(receipt.baseline).toMatchObject({
		commit: "0c6d27e4afacc42b598478d1fba532ef1eab9204",
		emptyInvocation: { selectorOpened: false, sessionFilesBefore: 0, sessionFilesAfterCancel: 0 },
		explicitRead: { sessionFilesBefore: 0, sessionFilesAfter: 0 },
	});
	expect(receipt.preFix).toMatchObject({
		commit: "e68d757fa7ebf6f6e5b36d52138e99712c565065",
		emptyInvocation: { selectorOpened: true, sessionFilesBefore: 0, sessionFilesAfterCancel: 0 },
		explicitRead: { sessionFilesBefore: 0, sessionFilesAfter: 0 },
	});
	expect(receipt.baseline.explicitRead.viewport).toContain("Next turn forced to use read.");
	expect(receipt.preFix.explicitRead.viewport).toContain("Queued read once, then no tools.");
	expect(receipt.classification).toContain("intentional-safety-addition");
	expect(ledger.entries.find(entry => entry.command === "/force")).toMatchObject({
		behaviorClassification: "intentional-safety-addition",
		baselineReceipts: [
			"packages/coding-agent/test/evidence/slash-command-handler-differential-v1/receipt.json",
			"packages/coding-agent/test/evidence/force-differential-v1/receipt.json",
		],
		currentReceipts: [
			"packages/coding-agent/test/evidence/slash-command-handler-differential-v1/receipt.json",
			"packages/coding-agent/test/evidence/force-differential-v1/receipt.json",
		],
	});
});

test("fast differential retains published command paths and records reviewed session persistence", async () => {
	const receipt = (await Bun.file(fastReceiptsFile).json()) as {
		schemaVersion: number;
		kind: string;
		keyboardProbe: boolean;
		baseline: { commit: string; surfaces: Array<{ surface: string; startup: string; openedViewport: string }> };
		current: { commit: string; surfaces: Array<{ surface: string; startup: string; openedViewport: string }> };
	};
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: ParityEntry[] };
	expect(receipt).toMatchObject({
		schemaVersion: 1,
		kind: "interactive-top-level-open-cancel-only",
		keyboardProbe: true,
	});
	for (const side of [receipt.baseline, receipt.current]) {
		expect(side.commit).toMatch(/^[0-9a-f]{40}$/);
		expect(side.surfaces.map(surface => surface.surface).toSorted()).toEqual(
			["/fast", "/fast status", "/fast on", "/fast off", "/fast toggle"].toSorted(),
		);
		expect(side.surfaces.every(surface => surface.startup === "ready")).toBe(true);
	}
	expect(receipt.baseline.surfaces.find(surface => surface.surface === "/fast on")?.openedViewport).toContain(
		"Fast mode enabled.",
	);
	expect(receipt.current.surfaces.find(surface => surface.surface === "/fast on")?.openedViewport).toContain(
		"Review fast mode",
	);
	expect(ledger.entries.find(entry => entry.command === "/fast")).toMatchObject({
		behaviorClassification: "intentional-safety-addition",
		baselineReceipts: ["packages/coding-agent/test/evidence/fast-differential-v1/receipts.json"],
		currentReceipts: ["packages/coding-agent/test/evidence/fast-differential-v1/receipts.json"],
		correctingTests: ["packages/coding-agent/test/slash-commands/fast.test.ts"],
	});
});

test("route differential retains published command paths and records reviewed routing persistence", async () => {
	const receipt = (await Bun.file(routeReceiptsFile).json()) as {
		schemaVersion: number;
		kind: string;
		keyboardProbe: boolean;
		baseline: { commit: string; surfaces: Array<{ surface: string; startup: string; openedViewport: string }> };
		current: { commit: string; surfaces: Array<{ surface: string; startup: string; openedViewport: string }> };
	};
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: ParityEntry[] };
	expect(receipt).toMatchObject({
		schemaVersion: 1,
		kind: "interactive-top-level-open-cancel-only",
		keyboardProbe: true,
	});
	for (const side of [receipt.baseline, receipt.current]) {
		expect(side.commit).toMatch(/^[0-9a-f]{40}$/);
		expect(side.surfaces.map(surface => surface.surface).toSorted()).toEqual(
			[
				"/route",
				"/route status",
				"/route off",
				"/route shadow",
				"/route auto",
				"/route profile",
				"/route invalid",
			].toSorted(),
		);
		expect(side.surfaces.every(surface => surface.startup === "ready")).toBe(true);
	}
	expect(receipt.current.surfaces.find(surface => surface.surface === "/route auto")?.openedViewport).toContain(
		"Review routing mode",
	);
	expect(receipt.current.surfaces.find(surface => surface.surface === "/route invalid")?.openedViewport).toContain(
		"Unknown /route subcommand",
	);
	expect(ledger.entries.find(entry => entry.command === "/route")).toMatchObject({
		behaviorClassification: "intentional-safety-addition",
		baselineReceipts: ["packages/coding-agent/test/evidence/route-differential-v1/receipts.json"],
		currentReceipts: ["packages/coding-agent/test/evidence/route-differential-v1/receipts.json"],
		correctingTests: ["packages/coding-agent/test/slash-commands/route.test.ts"],
	});
});

test("plan differential retains immediate published paths and records reviewed planning transitions", async () => {
	const receipt = (await Bun.file(planReceiptsFile).json()) as {
		schemaVersion: number;
		kind: string;
		keyboardProbe: boolean;
		baseline: { commit: string; surfaces: Array<{ surface: string; startup: string; openedViewport: string }> };
		current: { commit: string; surfaces: Array<{ surface: string; startup: string; openedViewport: string }> };
	};
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: ParityEntry[] };
	expect(receipt).toMatchObject({
		schemaVersion: 1,
		kind: "interactive-top-level-open-cancel-only",
		keyboardProbe: true,
	});
	for (const side of [receipt.baseline, receipt.current]) {
		expect(side.commit).toMatch(/^[0-9a-f]{40}$/);
		expect(side.surfaces.map(surface => surface.surface).toSorted()).toEqual(
			["/plan", "/plan Continue synthetic planning without leaving plan mode"].toSorted(),
		);
		expect(side.surfaces.every(surface => surface.startup === "ready")).toBe(true);
	}
	expect(receipt.current.surfaces.find(surface => surface.surface === "/plan")?.openedViewport).toContain(
		"Enable plan mode",
	);
	expect(
		receipt.current.surfaces.find(surface => surface.surface.includes("Continue synthetic planning"))?.openedViewport,
	).toContain("Review plan mode");
	expect(ledger.entries.find(entry => entry.command === "/plan")).toMatchObject({
		behaviorClassification: "intentional-safety-addition",
		baselineReceipts: ["packages/coding-agent/test/evidence/plan-differential-v1/receipts.json"],
		currentReceipts: ["packages/coding-agent/test/evidence/plan-differential-v1/receipts.json"],
		correctingTests: [
			"packages/coding-agent/test/interactive-mode-plan-review.test.ts",
			"packages/coding-agent/test/plan-mode/approved-plan.test.ts",
		],
	});
});

test("seeded compact differential records the intentional cancellation and interruption hierarchy", async () => {
	const receipt = (await Bun.file(
		new URL("./evidence/compact-seeded-differential-v1/receipt.json", import.meta.url),
	).json()) as {
		schemaVersion: number;
		kind: string;
		baseline: {
			commit: string;
			baseline: {
				escapeInterrupted: boolean;
				interruptedBytesUnchanged: boolean;
				successPersisted: boolean;
				reopenedSummary: boolean;
			};
		};
		preFix: {
			commit: string;
			preFix: {
				reviewOpened: boolean;
				cancelledBytesUnchanged: boolean;
				escapeNavigationOnly: boolean;
				ctrlCInterrupted: boolean;
				interruptedBytesUnchanged: boolean;
				successPersisted: boolean;
				reopenedSummary: boolean;
				noopBytesAndRequestsUnchanged: boolean;
			};
		};
		classification: string;
	};
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: ParityEntry[] };
	expect(receipt).toMatchObject({
		schemaVersion: 1,
		kind: "interactive-compact-seeded-differential",
		baseline: {
			commit: "0c6d27e4afacc42b598478d1fba532ef1eab9204",
			baseline: {
				escapeInterrupted: true,
				interruptedBytesUnchanged: true,
				successPersisted: true,
				reopenedSummary: true,
			},
		},
		preFix: {
			commit: "e68d757fa7ebf6f6e5b36d52138e99712c565065",
			preFix: {
				reviewOpened: true,
				cancelledBytesUnchanged: true,
				escapeNavigationOnly: true,
				ctrlCInterrupted: true,
				interruptedBytesUnchanged: true,
				successPersisted: true,
				reopenedSummary: true,
				noopBytesAndRequestsUnchanged: true,
			},
		},
	});
	expect(receipt.classification).toContain("intentional-safety-addition");
	expect(ledger.entries.find(entry => entry.command === "/compact")).toMatchObject({
		behaviorClassification: "intentional-safety-addition",
		baselineReceipts: [
			"packages/coding-agent/test/evidence/compact-differential-v1/receipts.json",
			"packages/coding-agent/test/evidence/compact-seeded-differential-v1/receipt.json",
		],
		currentReceipts: [
			"packages/coding-agent/test/evidence/compact-differential-v1/receipts.json",
			"packages/coding-agent/test/evidence/compact-seeded-differential-v1/receipt.json",
		],
		correctingTests: [
			"packages/coding-agent/test/compaction.test.ts",
			"packages/coding-agent/test/compaction-provider-boundary.test.ts",
		],
	});
});

test("foundation credential and model workflows retain pinned reachability and candidate safety evidence", async () => {
	const differential = (await Bun.file(
		new URL("./evidence/foundation-login-model-differential-v1/receipts.json", import.meta.url),
	).json()) as {
		baseline: { commit: string; surfaces: Array<{ surface: string; entered: boolean; escapeSent: boolean }> };
		current: { commit: string; surfaces: Array<{ surface: string; entered: boolean; escapeSent: boolean }> };
	};
	const matrix = (await Bun.file(
		new URL("./evidence/terminal-foundation-login-model-final-v1/matrix.json", import.meta.url),
	).json()) as {
		fixture: string;
		runs: Array<{
			exitCode: number;
			passed: boolean;
			receipt: {
				persistence: {
					providerReviewCancelPreservedCredential: boolean;
					liteLlmConnectionPersisted: boolean;
					conversationModelAndPinReopened: boolean;
					conversationNoopBytesUnchanged: boolean;
					defaultModelReopened: string;
					smolRoleReopened: string;
					logoutRemovalReopened: boolean;
				};
			};
		}>;
	};
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: ParityEntry[] };
	for (const side of [differential.baseline, differential.current]) {
		expect(side.commit).toMatch(/^[0-9a-f]{40}$/);
		for (const surface of ["/login", "/logout", "/model", "/models"])
			expect(side.surfaces.find(candidate => candidate.surface === surface)).toMatchObject({
				entered: true,
				escapeSent: true,
			});
	}
	expect(matrix).toMatchObject({ fixture: "foundation-login-model" });
	expect(matrix.runs).toHaveLength(16);
	for (const run of matrix.runs) {
		expect(run).toMatchObject({ exitCode: 0, passed: true });
		expect(run.receipt.persistence).toMatchObject({
			providerReviewCancelPreservedCredential: true,
			liteLlmConnectionPersisted: true,
			conversationModelAndPinReopened: true,
			conversationNoopBytesUnchanged: true,
			defaultModelReopened: "anthropic/claude-opus-5",
			smolRoleReopened: "anthropic/claude-haiku-4-5:low",
			logoutRemovalReopened: true,
		});
	}
	for (const command of ["/login", "/logout", "/model"]) {
		expect(ledger.entries.find(entry => entry.command === command)).toMatchObject({
			behaviorClassification: "intentional-safety-addition",
			baselineReceipts: ["packages/coding-agent/test/evidence/foundation-login-model-differential-v1/receipts.json"],
			currentReceipts: ["packages/coding-agent/test/evidence/foundation-login-model-differential-v1/receipts.json"],
		});
	}
	expect(ledger.entries.find(entry => entry.command === "/model")).toMatchObject({
		surfaceClassifications: { "/models": "intentional-safety-addition" },
		correctingTests: ["packages/coding-agent/test/modes/controllers/selector-controller-model-review.test.ts"],
	});
});

test("browser and Chrome retain pinned command surfaces with reviewed side-effect evidence", async () => {
	const matrix = (await Bun.file(
		new URL("./evidence/terminal-browser-chrome-final-v1/matrix.json", import.meta.url),
	).json()) as {
		fixture: string;
		runs: Array<{
			exitCode: number;
			passed: boolean;
			receipt: {
				persistence: {
					browserHeadless: boolean;
					cancelledChoiceBytesUnchanged: boolean;
					cancelledReviewBytesUnchanged: boolean;
					statusBytesUnchanged: boolean;
					noopBytesUnchanged: boolean;
					statusProbeOnly: boolean;
					cancelledChromePerformedNoAttachment: boolean;
					confirmedChromeAttachment: boolean;
					failedAttachmentStayedUnresolved: boolean;
					retryAfterEndpointRecovery: boolean;
				};
			};
		}>;
	};
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: ParityEntry[] };
	expect(matrix).toMatchObject({ fixture: "browser-chrome" });
	expect(matrix.runs).toHaveLength(16);
	for (const run of matrix.runs) {
		expect(run).toMatchObject({ exitCode: 0, passed: true });
		expect(run.receipt.persistence).toMatchObject({
			browserHeadless: false,
			cancelledChoiceBytesUnchanged: true,
			cancelledReviewBytesUnchanged: true,
			statusBytesUnchanged: true,
			noopBytesUnchanged: true,
			statusProbeOnly: true,
			cancelledChromePerformedNoAttachment: true,
			confirmedChromeAttachment: true,
			failedAttachmentStayedUnresolved: true,
			retryAfterEndpointRecovery: true,
		});
	}
	expect(ledger.entries.find(entry => entry.command === "/browser")).toMatchObject({
		behaviorClassification: "intentional-safety-addition",
		surfaceClassifications: {
			"/browser status": "additive",
			"/browser headless": "intentional-safety-addition",
			"/browser visible": "intentional-safety-addition",
		},
		correctingTests: ["packages/coding-agent/test/slash-commands/browser.test.ts"],
	});
	expect(ledger.entries.find(entry => entry.command === "/chrome")).toMatchObject({
		behaviorClassification: "intentional-safety-addition",
		surfaceClassifications: {
			"/chrome status": "intentional-redesign",
			"/chrome relaunch": "intentional-safety-addition",
		},
		correctingTests: ["packages/coding-agent/test/slash-commands/browser.test.ts"],
	});
});

test("clipboard and external-launch actions retain reviewed no-side-effect boundaries", async () => {
	const clipboardMatrix = (await Bun.file(
		new URL("./evidence/terminal-copy-clipboard-final-v1/matrix.json", import.meta.url),
	).json()) as {
		fixture: string;
		runs: Array<{
			exitCode: number;
			passed: boolean;
			receipt: {
				persistence: {
					cancelledLastUnchanged: boolean;
					cancelledSelectorUnchanged: boolean;
					cancelledDumpUnchanged: boolean;
					noMutationBeforeReview: boolean;
					sessionBytesUnchanged: boolean;
					reopenedSessionTextUnchanged: boolean;
					clipboardReads: Record<string, string>;
				};
			};
		}>;
	};
	const launcherMatrix = (await Bun.file(
		new URL("./evidence/terminal-publication-launcher-final-v1/matrix.json", import.meta.url),
	).json()) as {
		fixture: string;
		runs: Array<{
			exitCode: number;
			passed: boolean;
			receipt: {
				persistence: {
					openCancelMadeNoAttempt: boolean;
					openStaleTargetRenewed: boolean;
					openFailureRetriedOnce: boolean;
					launcherAttempts: string[];
				};
			};
		}>;
	};
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: ParityEntry[] };
	expect(clipboardMatrix).toMatchObject({ fixture: "copy-clipboard" });
	expect(clipboardMatrix.runs).toHaveLength(16);
	for (const run of clipboardMatrix.runs) {
		expect(run).toMatchObject({ exitCode: 0, passed: true });
		expect(run.receipt.persistence).toMatchObject({
			cancelledLastUnchanged: true,
			cancelledSelectorUnchanged: true,
			cancelledDumpUnchanged: true,
			noMutationBeforeReview: true,
			sessionBytesUnchanged: true,
			reopenedSessionTextUnchanged: true,
		});
		for (const copied of ["copy-last", "copy-code", "copy-all", "copy-cmd", "copy-link", "copy-selector", "dump"])
			expect(run.receipt.persistence.clipboardReads[copied]).toBeString();
	}
	expect(launcherMatrix).toMatchObject({ fixture: "publication-launcher" });
	expect(launcherMatrix.runs).toHaveLength(16);
	for (const run of launcherMatrix.runs) {
		expect(run).toMatchObject({ exitCode: 0, passed: true });
		expect(run.receipt.persistence).toMatchObject({
			openCancelMadeNoAttempt: true,
			openStaleTargetRenewed: true,
			openFailureRetriedOnce: true,
		});
		expect(run.receipt.persistence.launcherAttempts).toContain("https://example.test/changed-after-review");
	}
	for (const command of ["/copy", "/dump", "/open"])
		expect(ledger.entries.find(entry => entry.command === command)).toMatchObject({
			behaviorClassification: "intentional-safety-addition",
		});
	expect(ledger.entries.find(entry => entry.command === "/open")).toMatchObject({
		baselineReceipts: ["packages/coding-agent/test/evidence/slash-command-open-cancel-differential-v1/receipts.json"],
		currentReceipts: ["packages/coding-agent/test/evidence/slash-command-open-cancel-differential-v1/receipts.json"],
		correctingTests: ["packages/coding-agent/test/modes/controllers/command-controller-open.test.ts"],
	});
});

test("session tree, branch, and resume retain reviewed lifecycle evidence", async () => {
	const matrix = (await Bun.file(
		new URL("./evidence/terminal-sessions-final-v1/matrix.json", import.meta.url),
	).json()) as {
		fixture: string;
		runs: Array<{
			exitCode: number;
			passed: boolean;
			receipt: {
				persistence: {
					treeSummaryPersistedExactlyOnce: boolean;
					branchCreatedExactlyOneSession: boolean;
					resumeVerifiedIdentity: boolean;
				};
			};
		}>;
	};
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: ParityEntry[] };
	expect(matrix).toMatchObject({ fixture: "sessions" });
	expect(matrix.runs).toHaveLength(16);
	for (const run of matrix.runs) {
		expect(run).toMatchObject({ exitCode: 0, passed: true });
		expect(run.receipt.persistence).toMatchObject({
			treeSummaryPersistedExactlyOnce: true,
			branchCreatedExactlyOneSession: true,
			resumeVerifiedIdentity: true,
		});
	}
	expect(ledger.entries.find(entry => entry.command === "/session")).toMatchObject({
		behaviorClassification: "intentional-safety-addition",
		surfaceClassifications: {
			"/session info": "intentional-redesign",
			"/session delete": "intentional-safety-addition",
		},
	});
	expect(ledger.entries.find(entry => entry.command === "/branch")).toMatchObject({
		behaviorClassification: "intentional-redesign",
	});
	for (const command of ["/tree", "/resume"])
		expect(ledger.entries.find(entry => entry.command === command)).toMatchObject({
			behaviorClassification: "intentional-safety-addition",
			baselineReceipts: [
				"packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
			],
		});
});

test("publication and handoff retain their reviewed side-effect boundaries", async () => {
	const publicationMatrix = (await Bun.file(
		new URL("./evidence/terminal-publication-launcher-final-v1/matrix.json", import.meta.url),
	).json()) as {
		fixture: string;
		runs: Array<{
			exitCode: number;
			passed: boolean;
			receipt: {
				persistence: {
					exportNoopPreservedInodeMtimeAndBytes: boolean;
					exportPermissions: string;
					exportSavedBeforeOpenFailure: boolean;
					exportStaleCancellationPreservedConcurrentBytes: boolean;
					shareCancelMadeNoAttempt: boolean;
					shareFailureRetriedOnce: boolean;
					shareStagingRemoved: boolean;
					shareUrlDisplayedWithoutAutomaticOpen: boolean;
				};
			};
		}>;
	};
	const sessionsMatrix = (await Bun.file(
		new URL("./evidence/terminal-sessions-final-v1/matrix.json", import.meta.url),
	).json()) as {
		fixture: string;
		runs: Array<{
			exitCode: number;
			passed: boolean;
			receipt: {
				persistence: {
					handoffCancelAvoidedModelWork: boolean;
					handoffContextReopened: boolean;
				};
			};
		}>;
	};
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: ParityEntry[] };

	expect(publicationMatrix).toMatchObject({ fixture: "publication-launcher" });
	expect(publicationMatrix.runs).toHaveLength(16);
	for (const run of publicationMatrix.runs) {
		expect(run).toMatchObject({ exitCode: 0, passed: true });
		expect(run.receipt.persistence).toMatchObject({
			exportNoopPreservedInodeMtimeAndBytes: true,
			exportPermissions: "0600",
			exportSavedBeforeOpenFailure: true,
			exportStaleCancellationPreservedConcurrentBytes: true,
			shareCancelMadeNoAttempt: true,
			shareFailureRetriedOnce: true,
			shareStagingRemoved: true,
			shareUrlDisplayedWithoutAutomaticOpen: true,
		});
	}
	expect(sessionsMatrix).toMatchObject({ fixture: "sessions" });
	expect(sessionsMatrix.runs).toHaveLength(16);
	for (const run of sessionsMatrix.runs) {
		expect(run).toMatchObject({ exitCode: 0, passed: true });
		expect(run.receipt.persistence).toMatchObject({
			handoffCancelAvoidedModelWork: true,
			handoffContextReopened: true,
		});
	}
	for (const command of ["/export", "/share", "/handoff"])
		expect(ledger.entries.find(entry => entry.command === command)).toMatchObject({
			behaviorClassification: "intentional-safety-addition",
			baselineReceipts: [
				"packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
			],
			currentReceipts: [
				"packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
			],
		});
	expect(ledger.entries.find(entry => entry.command === "/export")).toMatchObject({
		correctingTests: ["packages/coding-agent/test/modes/controllers/command-controller-export.test.ts"],
	});
	expect(ledger.entries.find(entry => entry.command === "/share")).toMatchObject({
		correctingTests: ["packages/coding-agent/test/modes/controllers/command-controller-export.test.ts"],
	});
	expect(ledger.entries.find(entry => entry.command === "/handoff")).toMatchObject({
		correctingTests: ["packages/coding-agent/test/modes/controllers/command-controller-handoff.test.ts"],
	});
});

test("agent, extension, and plugin surfaces retain reviewed lifecycle evidence", async () => {
	const lifecycle = (await Bun.file(
		new URL("./evidence/terminal-plugin-lifecycle-final-v1/matrix.json", import.meta.url),
	).json()) as {
		fixture: string;
		runs: Array<{
			exitCode: number;
			passed: boolean;
			receipt: {
				persistence: {
					installCancelBytesUnchanged: boolean;
					pluginRemovedAfterReopen: boolean;
					upgradedVersionReopened: boolean;
				};
			};
		}>;
	};
	const refresh = (await Bun.file(
		new URL("./evidence/terminal-plugin-metadata-refresh-final-v1/matrix.json", import.meta.url),
	).json()) as {
		fixture: string;
		runs: Array<{
			exitCode: number;
			passed: boolean;
			receipt: { persistence: { commandSourceBytesUnchanged: boolean; newCommandDiscoveredAfterRefresh: boolean } };
		}>;
	};
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: ParityEntry[] };
	for (const matrix of [lifecycle, refresh]) {
		expect(matrix.runs).toHaveLength(16);
		for (const run of matrix.runs) expect(run).toMatchObject({ exitCode: 0, passed: true });
	}
	expect(lifecycle).toMatchObject({ fixture: "plugin-lifecycle" });
	expect(lifecycle.runs[0]?.receipt.persistence).toMatchObject({
		installCancelBytesUnchanged: true,
		pluginRemovedAfterReopen: true,
		upgradedVersionReopened: "2.0.0",
	});
	expect(refresh).toMatchObject({ fixture: "plugin-metadata-refresh" });
	expect(refresh.runs[0]?.receipt.persistence).toMatchObject({
		commandSourceBytesUnchanged: true,
		newCommandDiscoveredAfterRefresh: true,
	});
	for (const command of ["/agents", "/extensions", "/plugin"])
		expect(ledger.entries.find(entry => entry.command === command)).toMatchObject({
			behaviorClassification: "intentional-safety-addition",
			baselineReceipts: [
				"packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
			],
		});
	expect(ledger.entries.find(entry => entry.command === "/extensions")).toMatchObject({
		surfaceClassifications: { "/status": "intentional-safety-addition" },
	});
	expect(ledger.entries.find(entry => entry.command === "/plugin")).toMatchObject({
		surfaceClassifications: {
			"/plugin install": "intentional-safety-addition",
			"/plugin list": "intentional-redesign",
		},
	});
});

test("context, MCP, and SSH preserve every registered surface with reviewed state changes", async () => {
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: ParityEntry[] };
	const expected = {
		"/context": {
			"/context list": "intentional-redesign",
			"/context create": "intentional-safety-addition",
			"/context delete": "intentional-safety-addition",
			"/context link": "additive",
			"/context unlink": "additive",
		},
		"/mcp": {
			"/mcp add": "intentional-safety-addition",
			"/mcp list": "intentional-redesign",
			"/mcp smithery-login": "intentional-safety-addition",
			"/mcp help": "intentional-redesign",
		},
		"/ssh": {
			"/ssh add": "intentional-safety-addition",
			"/ssh list": "intentional-redesign",
			"/ssh remove": "intentional-safety-addition",
			"/ssh help": "intentional-redesign",
		},
	} as const;
	for (const [command, surfaceClassifications] of Object.entries(expected)) {
		const entry = ledger.entries.find(candidate => candidate.command === command);
		expect(entry).toMatchObject({
			behaviorClassification: "intentional-safety-addition",
			baselineReceipts: [
				"packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
			],
			currentReceipts: [
				"packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
			],
			surfaceClassifications,
		});
		for (const classification of Object.values(entry?.surfaceClassifications ?? {}))
			expect(classification).not.toBe("pending-differential-uat");
	}
	expect(ledger.entries.find(entry => entry.command === "/context")).toMatchObject({
		correctingTests: ["packages/coding-agent/test/modes/controllers/context-command-controller-review.test.ts"],
	});
	expect(ledger.entries.find(entry => entry.command === "/mcp")).toMatchObject({
		correctingTests: [
			"packages/coding-agent/test/modes/controllers/mcp-command-controller-review.test.ts",
			"packages/coding-agent/test/modes/controllers/mcp-command-controller-smithery.test.ts",
		],
	});
	expect(ledger.entries.find(entry => entry.command === "/ssh")).toMatchObject({
		correctingTests: ["packages/coding-agent/test/modes/controllers/ssh-command-controller-review.test.ts"],
	});
});

test("reload-plugins documents metadata refresh without process restart", async () => {
	const receipt = (await Bun.file(
		new URL("./evidence/reload-plugins-differential-v1/receipts.json", import.meta.url),
	).json()) as {
		baseline: { commit: string; surfaces: Array<{ startup: string; openedViewport: string }> };
		current: { commit: string; surfaces: Array<{ startup: string; openedViewport: string }> };
	};
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: ParityEntry[] };
	expect(receipt.baseline).toMatchObject({ commit: "0c6d27e4afacc42b598478d1fba532ef1eab9204" });
	expect(receipt.current).toMatchObject({ commit: "e68d757fa7ebf6f6e5b36d52138e99712c565065" });
	expect(receipt.baseline.surfaces).toHaveLength(1);
	expect(receipt.current.surfaces).toHaveLength(1);
	expect(receipt.baseline.surfaces[0]).toMatchObject({ startup: "ready" });
	expect(receipt.current.surfaces[0]).toMatchObject({ startup: "ready" });
	expect(receipt.baseline.surfaces[0]?.openedViewport).toContain("Plugins reloaded.");
	expect(receipt.current.surfaces[0]?.openedViewport).toContain("Plugin metadata refreshed.");
	expect(receipt.current.surfaces[0]?.openedViewport).toContain("were not restarted.");
	expect(ledger.entries.find(entry => entry.command === "/reload-plugins")).toMatchObject({
		behaviorClassification: "intentional-redesign",
		baselineReceipts: ["packages/coding-agent/test/evidence/reload-plugins-differential-v1/receipts.json"],
		currentReceipts: ["packages/coding-agent/test/evidence/reload-plugins-differential-v1/receipts.json"],
		correctingTests: ["packages/coding-agent/test/slash-commands/reload-plugins.test.ts"],
	});
});

test("new session changes from immediate replacement to a reviewed lifecycle action", async () => {
	const receipt = (await Bun.file(
		new URL("./evidence/new-differential-v1/receipts.json", import.meta.url),
	).json()) as {
		baseline: { commit: string; surfaces: Array<{ startup: string; openedViewport: string }> };
		current: { commit: string; surfaces: Array<{ startup: string; openedViewport: string }> };
	};
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: ParityEntry[] };
	expect(receipt.baseline).toMatchObject({ commit: "0c6d27e4afacc42b598478d1fba532ef1eab9204" });
	expect(receipt.current).toMatchObject({ commit: "e68d757fa7ebf6f6e5b36d52138e99712c565065" });
	expect(receipt.baseline.surfaces[0]).toMatchObject({ startup: "ready" });
	expect(receipt.current.surfaces[0]).toMatchObject({ startup: "ready" });
	expect(receipt.current.surfaces[0]?.openedViewport).toContain("Review new session");
	expect(receipt.current.surfaces[0]?.openedViewport).toContain("Confirm change");
	expect(ledger.entries.find(entry => entry.command === "/new")).toMatchObject({
		behaviorClassification: "intentional-safety-addition",
		baselineReceipts: ["packages/coding-agent/test/evidence/new-differential-v1/receipts.json"],
		currentReceipts: ["packages/coding-agent/test/evidence/new-differential-v1/receipts.json"],
		correctingTests: ["packages/coding-agent/test/modes/controllers/command-controller-new.test.ts"],
	});
});

test("fork changes from immediate copying to a reviewed parent-linked session action", async () => {
	const receipt = (await Bun.file(
		new URL("./evidence/fork-differential-v1/receipts.json", import.meta.url),
	).json()) as {
		baseline: { commit: string; surfaces: Array<{ startup: string; openedViewport: string }> };
		current: { commit: string; surfaces: Array<{ startup: string; openedViewport: string }> };
	};
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: ParityEntry[] };
	expect(receipt.baseline).toMatchObject({ commit: "0c6d27e4afacc42b598478d1fba532ef1eab9204" });
	expect(receipt.current).toMatchObject({ commit: "e68d757fa7ebf6f6e5b36d52138e99712c565065" });
	expect(receipt.baseline.surfaces[0]).toMatchObject({ startup: "ready" });
	expect(receipt.current.surfaces[0]).toMatchObject({ startup: "ready" });
	expect(receipt.current.surfaces[0]?.openedViewport).toContain("Review session fork");
	expect(receipt.current.surfaces[0]?.openedViewport).toContain("parent link");
	expect(ledger.entries.find(entry => entry.command === "/fork")).toMatchObject({
		behaviorClassification: "intentional-safety-addition",
		baselineReceipts: ["packages/coding-agent/test/evidence/fork-differential-v1/receipts.json"],
		currentReceipts: ["packages/coding-agent/test/evidence/fork-differential-v1/receipts.json"],
		correctingTests: ["packages/coding-agent/test/modes/controllers/command-controller-fork.test.ts"],
	});
});

test("MCP resource-client differential receipt remains pinned and complete", async () => {
	const receipt = (await Bun.file(clientResourcesReceiptsFile).json()) as {
		schemaVersion: number;
		kind: string;
		baseline: { commit: string; exitCode: number; stderr: string };
		preFix: { commit: string; exitCode: number; stderr: string };
	};
	expect(receipt.schemaVersion).toBe(1);
	expect(receipt.kind).toBe("mcp-client-resource-contract-differential");
	for (const [side, expectedCommit] of [
		["baseline", "0c6d27e4afacc42b598478d1fba532ef1eab9204"],
		["preFix", "e68d757fa7ebf6f6e5b36d52138e99712c565065"],
	] as const) {
		expect(receipt[side]).toMatchObject({ commit: expectedCommit, exitCode: 0 });
		expect(receipt[side].stderr).toContain("21 pass");
		expect(receipt[side].stderr).toContain("0 fail");
	}
});

test("resource reads preserve baseline requests while mutation flows add reviewed safety", async () => {
	const receipt = (await Bun.file(resourceReviewReceiptsFile).json()) as {
		schemaVersion: number;
		kind: string;
		baseline: {
			commit: string;
			create: { requestCountBeforeEscape: number; objectPresentBeforeEscape: boolean };
			list: { requestCount: number; objectPresent: boolean; viewport: string };
			get: { requestCount: number; objectPresent: boolean; viewport: string };
			describe: { requestCount: number; objectPresent: boolean; viewport: string };
			diff: { requestCount: number; objectPresent: boolean; viewport: string };
			manifest: {
				requestCountBeforeEscape: number;
				fileExistsBeforeEscape: boolean;
				fileExistsAfterEscape: boolean;
				openedViewport: string;
			};
			dryRun: { updateCount: number; objectPresent: boolean; viewport: string };
			apply: { requestCountBeforeEscape: number; objectPresentBeforeEscape: boolean };
			delete: { requestCountBeforeEscape: number; objectPresentBeforeEscape: boolean };
			deleteFailureRetry: {
				failureRequestCount: number;
				objectPresentAfterFailure: boolean;
				failureViewport: string;
				retryRequestCount: number;
				objectPresentAfterRetry: boolean;
				retryViewport: string;
			};
		};
		preFix: {
			commit: string;
			create: {
				openedViewport: string;
				requestCountBeforeEscape: number;
				objectPresentBeforeEscape: boolean;
				requestCountAfterEscape: number;
				objectPresentAfterEscape: boolean;
				confirmed?: { requestCount: number; objectPresent: boolean; viewport: string };
			};
			list: { requestCount: number; objectPresent: boolean; viewport: string };
			get: { requestCount: number; objectPresent: boolean; viewport: string };
			describe: { requestCount: number; objectPresent: boolean; viewport: string };
			diff: { requestCount: number; objectPresent: boolean; viewport: string };
			manifest: {
				requestCountBeforeEscape: number;
				fileExistsBeforeEscape: boolean;
				fileExistsAfterEscape: boolean;
				openedViewport: string;
				unresolved?: { fileExists: boolean; viewport: string };
			};
			dryRun: { updateCount: number; objectPresent: boolean; viewport: string };
			apply: {
				openedViewport: string;
				requestCountBeforeEscape: number;
				objectPresentBeforeEscape: boolean;
				requestCountAfterEscape: number;
				objectPresentAfterEscape: boolean;
				confirmed?: { requestCount: number; objectPresent: boolean; viewport: string };
			};
			delete: {
				openedViewport: string;
				requestCountBeforeEscape: number;
				objectPresentBeforeEscape: boolean;
				requestCountAfterEscape: number;
				objectPresentAfterEscape: boolean;
				confirmed?: { requestCount: number; objectPresent: boolean; viewport: string };
			};
			deleteFailureRetry: {
				failureRequestCount: number;
				objectPresentAfterFailure: boolean;
				failureViewport: string;
				retryRequestCount: number;
				objectPresentAfterRetry: boolean;
				retryViewport: string;
			};
		};
	};
	expect(receipt.schemaVersion).toBe(1);
	expect(receipt.kind).toBe("interactive-resource-review-differential");
	expect(receipt.baseline).toMatchObject({
		commit: "0c6d27e4afacc42b598478d1fba532ef1eab9204",
		create: { requestCountBeforeEscape: 1, objectPresentBeforeEscape: true },
		list: { requestCount: 1, objectPresent: true },
		get: { requestCount: 1, objectPresent: true },
		describe: { requestCount: 1, objectPresent: true },
		diff: { requestCount: 1, objectPresent: true },
		manifest: { requestCountBeforeEscape: 1, fileExistsBeforeEscape: true, fileExistsAfterEscape: true },
		dryRun: { updateCount: 0, objectPresent: true },
		apply: { requestCountBeforeEscape: 1, objectPresentBeforeEscape: true },
		delete: { requestCountBeforeEscape: 1, objectPresentBeforeEscape: true },
		deleteFailureRetry: {
			failureRequestCount: 1,
			objectPresentAfterFailure: true,
			retryRequestCount: 1,
			objectPresentAfterRetry: false,
		},
	});
	expect(receipt.preFix).toMatchObject({
		commit: "e68d757fa7ebf6f6e5b36d52138e99712c565065",
		create: {
			requestCountBeforeEscape: 0,
			objectPresentBeforeEscape: false,
			requestCountAfterEscape: 0,
			objectPresentAfterEscape: false,
			confirmed: { requestCount: 1, objectPresent: true },
		},
		list: { requestCount: 1, objectPresent: true },
		get: { requestCount: 1, objectPresent: true },
		describe: { requestCount: 1, objectPresent: true },
		diff: { requestCount: 1, objectPresent: true },
		manifest: { requestCountBeforeEscape: 2, fileExistsBeforeEscape: false, fileExistsAfterEscape: false },
		dryRun: { updateCount: 0, objectPresent: true },
		apply: {
			requestCountBeforeEscape: 0,
			objectPresentBeforeEscape: true,
			requestCountAfterEscape: 0,
			objectPresentAfterEscape: true,
			confirmed: { requestCount: 1, objectPresent: true },
		},
		delete: {
			requestCountBeforeEscape: 0,
			objectPresentBeforeEscape: true,
			requestCountAfterEscape: 0,
			objectPresentAfterEscape: true,
			confirmed: { requestCount: 1, objectPresent: true },
		},
		deleteFailureRetry: {
			failureRequestCount: 1,
			objectPresentAfterFailure: true,
			retryRequestCount: 1,
			objectPresentAfterRetry: false,
		},
	});
	expect(receipt.preFix.create.openedViewport).toContain("Review resource create");
	expect(receipt.preFix.create.confirmed?.viewport).toContain("Resource create complete");
	expect(receipt.baseline.manifest.openedViewport).toContain("Exported 1 resource(s)");
	expect(receipt.preFix.manifest.openedViewport).toContain("Review manifest file export");
	expect(receipt.preFix.manifest.unresolved).toMatchObject({ fileExists: false });
	expect(receipt.preFix.manifest.unresolved?.viewport).toContain("1 manifest file failed");
	expect(receipt.baseline.list.viewport).toContain("NAME  NAMESPACE  AGE");
	expect(receipt.preFix.list.viewport).toContain("http_loadbalancer resources");
	for (const candidate of [receipt.baseline, receipt.preFix]) {
		expect(candidate.get.viewport).toContain("review-differential");
		expect(candidate.describe.viewport).toContain("review-differential");
		expect(candidate.diff.viewport).toContain("review-differential");
	}
	expect(receipt.baseline.dryRun.viewport).toContain(" dry-run");
	expect(receipt.preFix.dryRun.viewport).toContain("Resource apply dry run");
	expect(receipt.preFix.apply.openedViewport).toContain("Review resource apply");
	expect(receipt.preFix.apply.confirmed?.viewport).toContain("Resource apply complete");
	expect(receipt.preFix.delete.openedViewport).toContain("Review resource delete");
	expect(receipt.baseline.deleteFailureRetry.failureViewport).toContain("synthetic injected");
	expect(receipt.baseline.deleteFailureRetry.failureViewport).toContain("delete failure");
	expect(receipt.baseline.deleteFailureRetry.retryViewport).toContain("review-differential deleted");
	expect(receipt.preFix.delete.confirmed?.viewport).toContain("Unresolved resource delete");
	expect(receipt.preFix.deleteFailureRetry.failureViewport).toContain("Successful resources will not be retried");
	expect(receipt.preFix.deleteFailureRetry.retryViewport).toContain("Resource delete complete");
	const ledger = (await Bun.file(ledgerFile).json()) as { entries: ParityEntry[] };
	for (const command of ["/apply", "/create", "/delete"])
		expect(ledger.entries.find(entry => entry.command === command)).toMatchObject({
			behaviorClassification: "intentional-safety-addition",
			baselineReceipts: ["packages/coding-agent/test/evidence/resource-review-differential-v1/receipt.json"],
			currentReceipts: ["packages/coding-agent/test/evidence/resource-review-differential-v1/receipt.json"],
			correctingTests: ["packages/coding-agent/test/slash-commands/resource-commands-review.test.ts"],
		});
	for (const command of ["/describe", "/diff", "/get"])
		expect(ledger.entries.find(entry => entry.command === command)).toMatchObject({
			behaviorClassification: "intentional-redesign",
			baselineReceipts: ["packages/coding-agent/test/evidence/resource-review-differential-v1/receipt.json"],
			currentReceipts: ["packages/coding-agent/test/evidence/resource-review-differential-v1/receipt.json"],
			correctingTests: ["packages/coding-agent/test/slash-commands/resource-commands-review.test.ts"],
		});
});

test("full coding-agent differential is retained as failed source-contract evidence", async () => {
	const receipt = (await Bun.file(fullCodingAgentReceiptsFile).json()) as {
		schemaVersion: number;
		kind: string;
		baseline: { commit: string; exitCode: number; stderr: string };
		preFix: { commit: string; exitCode: number; stderr: string };
	};
	expect(receipt.schemaVersion).toBe(1);
	expect(receipt.kind).toBe("full-coding-agent-test-differential");
	expect(receipt.baseline).toMatchObject({
		commit: "0c6d27e4afacc42b598478d1fba532ef1eab9204",
		exitCode: 1,
	});
	expect(receipt.preFix).toMatchObject({
		commit: "e68d757fa7ebf6f6e5b36d52138e99712c565065",
		exitCode: 1,
	});
	expect(receipt.baseline.stderr).toContain("Ran 7261 tests across 712 files.");
	expect(receipt.preFix.stderr).toContain("Ran 8198 tests across 768 files.");
});

test("published and pre-fix discovery receipts cover every registered surface without mistaking input echo for discovery", async () => {
	const [ledger, receipts] = await Promise.all([
		Bun.file(ledgerFile).json() as Promise<{ entries: ParityEntry[] }>,
		Bun.file(discoveryReceiptsFile).json() as Promise<{
			schemaVersion: number;
			kind: string;
			baseline: DiscoverySideReceipt;
			current: DiscoverySideReceipt;
		}>,
	]);
	expect(receipts.schemaVersion).toBe(1);
	expect(receipts.kind).toBe("interactive-discovery-only");
	for (const [side, expectedCandidate, expectedCommit] of [
		["baseline", "published-v21.24.4", "0c6d27e4afacc42b598478d1fba532ef1eab9204"],
		["current", "pre-fix-e68d757", "e68d757fa7ebf6f6e5b36d52138e99712c565065"],
	] as const) {
		const receipt = receipts[side];
		expect(receipt.candidate).toBe(expectedCandidate);
		expect(receipt.commit).toBe(expectedCommit);
		expect(receipt.startup).toBe("ready");
		expect(receipt.surfaces.map(surface => surface.surface).toSorted()).toEqual(
			inventorySurfaces(ledger.entries, side),
		);
		for (const surface of receipt.surfaces) {
			expect(surface.reachable).toBe(surface.viewport.includes(`❯ ${surface.expectedLabel}`));
			expect(surface.viewport).not.toMatch(
				/\/Users\/|(?:\/private)?\/var\/folders\/|xcsh-terminal-uat-(?!XXXXXX\b)[A-Za-z0-9]{6}/,
			);
		}
	}
	const baselineBySurface = new Map(receipts.baseline.surfaces.map(surface => [surface.surface, surface]));
	for (const current of receipts.current.surfaces) {
		const baseline = baselineBySurface.get(current.surface);
		if (baseline) expect(current.reachable).toBe(baseline.reachable);
	}
});

test("published and pre-fix open-cancel receipts enter every top-level command in isolated real PTYs", async () => {
	const [ledger, receipts] = await Promise.all([
		Bun.file(ledgerFile).json() as Promise<{ entries: ParityEntry[] }>,
		Bun.file(openCancelReceiptsFile).json() as Promise<{
			schemaVersion: number;
			kind: string;
			baseline: DiscoverySideReceipt & {
				surfaces: Array<{
					surface: string;
					entered: boolean;
					escapeSent: boolean;
					processExited: boolean;
					openedViewport: string;
					cancelledViewport: string;
				}>;
			};
			current: DiscoverySideReceipt & {
				surfaces: Array<{
					surface: string;
					entered: boolean;
					escapeSent: boolean;
					processExited: boolean;
					openedViewport: string;
					cancelledViewport: string;
				}>;
			};
		}>,
	]);
	expect(receipts.schemaVersion).toBe(1);
	expect(receipts.kind).toBe("interactive-top-level-open-cancel-only");
	const expected = ledger.entries.map(entry => entry.command).toSorted();
	for (const [side, expectedCandidate, expectedCommit] of [
		["baseline", "published-v21.24.4", "0c6d27e4afacc42b598478d1fba532ef1eab9204"],
		["current", "pre-fix-e68d757", "e68d757fa7ebf6f6e5b36d52138e99712c565065"],
	] as const) {
		const receipt = receipts[side];
		expect(receipt.candidate).toBe(expectedCandidate);
		expect(receipt.commit).toBe(expectedCommit);
		expect(receipt.surfaces.map(surface => surface.surface).toSorted()).toEqual(expected);
		for (const surface of receipt.surfaces) {
			expect(surface.entered).toBe(true);
			expect(surface.openedViewport.length).toBeGreaterThan(0);
			expect(surface.cancelledViewport.length).toBeGreaterThan(0);
			expect(surface.openedViewport).not.toMatch(
				/\/Users\/|(?:\/private)?\/var\/folders\/|xcsh-terminal-uat-(?!XXXXXX\b)[A-Za-z0-9]{6}/,
			);
			if (surface.processExited) {
				expect(surface.surface).toMatch(/^\/(exit|quit)$/);
				expect(surface.escapeSent).toBe(false);
			} else expect(surface.escapeSent).toBe(true);
		}
	}
});

test("published and pre-fix open-cancel receipts enter every alias and subcommand in isolated real PTYs", async () => {
	const [ledger, receipts, retries] = await Promise.all([
		Bun.file(ledgerFile).json() as Promise<{ entries: ParityEntry[] }>,
		Bun.file(allSurfaceOpenCancelReceiptsFile).json() as Promise<{
			schemaVersion: number;
			kind: string;
			scope: string;
			baseline: DiscoverySideReceipt & {
				surfaces: Array<{
					surface: string;
					entered: boolean;
					escapeSent: boolean;
					processExited: boolean;
					openedViewport: string;
					cancelledViewport: string;
				}>;
			};
			current: DiscoverySideReceipt & {
				surfaces: Array<{
					surface: string;
					entered: boolean;
					escapeSent: boolean;
					processExited: boolean;
					openedViewport: string;
					cancelledViewport: string;
				}>;
			};
		}>,
		Bun.file(allSurfaceOpenCancelRetryReceiptsFile).json() as Promise<{
			baseline: { surfaces: Array<{ surface: string; entered: boolean; startup: "ready" | "failed" }> };
			current: { surfaces: Array<{ surface: string; entered: boolean; startup: "ready" | "failed" }> };
		}>,
	]);
	expect(receipts.schemaVersion).toBe(1);
	expect(receipts.kind).toBe("interactive-all-surfaces-open-cancel-only");
	expect(receipts.scope).toBe("top-level-aliases-subcommands");
	const transientPreFixStartupRetries = new Set(["/open", "/resume", "/route", "/ssh remove", "/status", "/tools"]);
	for (const [side, expectedCandidate, expectedCommit] of [
		["baseline", "published-v21.24.4", "0c6d27e4afacc42b598478d1fba532ef1eab9204"],
		["current", "pre-fix-e68d757", "e68d757fa7ebf6f6e5b36d52138e99712c565065"],
	] as const) {
		const receipt = receipts[side];
		const retryBySurface = new Map(retries[side].surfaces.map(surface => [surface.surface, surface]));
		expect(receipt.candidate).toBe(expectedCandidate);
		expect(receipt.commit).toBe(expectedCommit);
		expect(receipt.surfaces.map(surface => surface.surface).toSorted()).toEqual(
			inventorySurfaces(ledger.entries, side),
		);
		for (const surface of receipt.surfaces) {
			if (!surface.entered) {
				expect(side).toBe("current");
				expect(transientPreFixStartupRetries.has(surface.surface)).toBe(true);
				expect(retryBySurface.get(surface.surface)).toMatchObject({
					surface: surface.surface,
					entered: true,
					startup: "ready",
				});
				continue;
			}
			expect(surface.openedViewport.length).toBeGreaterThan(0);
			expect(surface.cancelledViewport.length).toBeGreaterThan(0);
			expect(surface.openedViewport).not.toMatch(
				/\/Users\/|(?:\/private)?\/var\/folders\/|xcsh-terminal-uat-(?!XXXXXX\b)[A-Za-z0-9]{6}/,
			);
			if (surface.processExited) {
				expect(surface.surface).toMatch(/^\/(exit|quit)$/);
				expect(surface.escapeSent).toBe(false);
			} else expect(surface.escapeSent).toBe(true);
		}
	}
});
