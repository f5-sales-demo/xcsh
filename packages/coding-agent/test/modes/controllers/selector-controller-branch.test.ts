import { afterEach, beforeAll, expect, test, vi } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Component } from "@f5-sales-demo/pi-tui";
import { SelectorController } from "../../../src/modes/controllers/selector-controller";
import { getThemeByName, setThemeInstance } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";
import { type SessionBranchPreview, SessionManager } from "../../../src/session/session-manager";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));
const directories: string[] = [];
afterEach(async () => {
	for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

async function harness(options: { failAfterCreate?: boolean } = {}) {
	const dir = await mkdtemp(join(tmpdir(), "xcsh-branch-review-"));
	directories.push(dir);
	const manager = SessionManager.create(dir, dir);
	manager.appendMessage({ role: "user", content: "First request", timestamp: 1 });
	const assistant = manager.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "First response" }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "fixture-model",
		stopReason: "stop",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		timestamp: 2,
	});
	const selected = manager.appendMessage({ role: "user", content: "Second editable request", timestamp: 3 });
	manager.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "Current response" }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "fixture-model",
		stopReason: "stop",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		timestamp: 4,
	});
	await manager.ensureOnDisk();
	await manager.flush();
	const sourceId = manager.getSessionId();
	const sourceFile = manager.getSessionFile()!;
	const sourceBytes = await readFile(sourceFile, "utf8");
	let pending: SessionBranchPreview | undefined;
	let failed = false;
	const branch = vi.fn(async (_entryId: string, preview?: SessionBranchPreview) => {
		if (!preview) throw new Error("Expected reviewed branch preview");
		if (!pending) {
			manager.createBranchedSession(assistant, preview);
			pending = preview;
			if (options.failAfterCreate && !failed) {
				failed = true;
				throw new Error("Fixture branch restoration failure");
			}
		}
		pending = undefined;
		return { selectedText: "Second editable request", cancelled: false };
	});
	const retryReviewedBranchCompletion = vi.fn(async (preview?: SessionBranchPreview) => {
		if (!pending || pending.targetSessionId !== preview?.targetSessionId) throw new Error("Wrong recovery target");
		await manager.retryPersistence();
		pending = undefined;
	});
	let inline: Component;
	let review: Component | undefined;
	const editor = {
		text: "",
		setText(value: string) {
			this.text = value;
		},
	};
	const editorContainer = {
		clear() {},
		addChild(component: Component) {
			inline = component;
		},
	};
	const session = {
		getUserMessagesForBranching: () => [
			{
				entryId: manager.getEntries().find(entry => entry.type === "message" && entry.message.role === "user")!.id,
				text: "First request",
			},
			{ entryId: selected, text: "Second editable request" },
		],
		branch,
		retryReviewedBranchCompletion,
	};
	const ctx = {
		sessionManager: manager,
		session,
		editor,
		editorContainer,
		chatContainer: { clear: vi.fn() },
		ui: { terminal: { rows: 24 }, setFocus() {}, requestRender() {} },
		renderInitialMessages: vi.fn(),
		showStatus: vi.fn(),
		showError: vi.fn(),
		showHookCustom: (
			factory: (ui: unknown, theme: unknown, keys: unknown, done: (value: unknown) => void) => Component,
		) =>
			new Promise(resolve => {
				review = factory(ctx.ui, {}, {}, resolve);
			}),
	} as unknown as InteractiveModeContext;
	const controller = new SelectorController(ctx);
	controller.showUserMessageSelector();
	const openReview = () => {
		inline.handleInput?.("\r");
		inline.handleInput?.("\r");
	};
	return {
		ctx,
		manager,
		branch,
		retryReviewedBranchCompletion,
		sourceId,
		sourceFile,
		sourceBytes,
		selected,
		openReview,
		review: () => review,
		reviewText: () => Bun.stripANSI(review?.render(100).join("\n") ?? ""),
	};
}

async function waitFor(predicate: () => boolean) {
	for (let index = 0; index < 300; index++) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Expected branch review state missing");
}

test("branch cancellation leaves source identity and bytes unchanged", async () => {
	const h = await harness();
	h.openReview();
	await waitFor(() => h.reviewText().includes("Review conversation branch"));
	expect(h.reviewText()).toContain(h.selected);
	h.review()!.handleInput?.("\r");
	await Bun.sleep(1);
	expect(h.branch).not.toHaveBeenCalled();
	expect(h.manager.getSessionId()).toBe(h.sourceId);
	expect(await readFile(h.sourceFile, "utf8")).toBe(h.sourceBytes);
});

test("confirmed branch creates the exact reviewed, parent-linked session", async () => {
	const h = await harness();
	h.openReview();
	await waitFor(() => h.reviewText().includes("Review conversation branch"));
	const reviewedTarget = h.reviewText().match(/Session identity: .* → ([a-z0-9]+)/)?.[1];
	if (!reviewedTarget) throw new Error("Expected exact reviewed target");
	h.review()!.handleInput?.("\x1b[B");
	h.review()!.handleInput?.("\r");
	await waitFor(() => h.branch.mock.calls.length === 1);
	expect(h.manager.getSessionId()).toBe(reviewedTarget);
	expect((await SessionManager.open(h.manager.getSessionFile()!)).getSessionId()).toBe(reviewedTarget);
	expect(await readFile(h.sourceFile, "utf8")).toBe(h.sourceBytes);
});

test("partial branch completion retries the same destination without creating another", async () => {
	const h = await harness({ failAfterCreate: true });
	h.openReview();
	await waitFor(() => h.reviewText().includes("Review conversation branch"));
	h.review()!.handleInput?.("\x1b[B");
	h.review()!.handleInput?.("\r");
	await waitFor(() => h.reviewText().includes("Fixture branch restoration failure"));
	const createdId = h.manager.getSessionId();
	h.review()!.handleInput?.("\x1b[B");
	h.review()!.handleInput?.("\r");
	await waitFor(() => h.reviewText().includes("proposal changed"));
	h.review()!.handleInput?.("\x1b[B");
	h.review()!.handleInput?.("\r");
	await waitFor(() => h.retryReviewedBranchCompletion.mock.calls.length === 1);
	expect(h.branch).toHaveBeenCalledTimes(1);
	expect(h.manager.getSessionId()).toBe(createdId);
});
