import { afterEach, beforeAll, beforeEach, expect, test, vi } from "bun:test";
import * as native from "@f5-sales-demo/pi-natives";
import type { Component } from "@f5-sales-demo/pi-tui";
import { CommandController } from "../../../src/modes/controllers/command-controller";
import { setTheme } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";
import * as clipboard from "../../../src/utils/clipboard";

beforeAll(async () => {
	await setTheme("xcsh-dark");
});
// Also isolate the legacy implementation while demonstrating the regression.
beforeEach(() => {
	vi.spyOn(native, "copyToClipboard").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

function harness() {
	let content = "Synthetic conversation";
	let id = "synthetic-session";
	let component: Component | undefined;
	const ctx = {
		session: {
			formatSessionAsText: () => content,
			getLastAssistantText: () => content,
			get messages() {
				return [
					{
						role: "assistant",
						content: [
							{ type: "text", text: content },
							{ type: "toolCall", id: "synthetic-call", name: "bash", arguments: { command: "echo synthetic" } },
						],
					},
				];
			},
		},
		sessionManager: { getSessionId: () => id },
		showStatus: vi.fn(),
		showWarning: vi.fn(),
		showError: vi.fn(),
		showHookCustom: (factory: any) =>
			new Promise(resolve => {
				component = factory({ terminal: { rows: 32 }, requestRender() {} }, {}, {}, resolve);
			}),
	} as unknown as InteractiveModeContext;
	return {
		ctx,
		controller: new CommandController(ctx),
		text: () => (component ? Bun.stripANSI(component.render(100).join("\n")) : ""),
		input: (key: string) => component?.handleInput?.(key),
		changeContent: (value = "Changed synthetic conversation") => {
			content = value;
		},
		changeSession: () => {
			id = "different-session";
		},
	};
}
async function waitFor(predicate: () => boolean) {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) return;
		await Bun.sleep(5);
	}
	throw new Error("Dump review state not reached");
}

test("dump describes Unicode payload size without exposing conversation text", async () => {
	const copy = vi.spyOn(clipboard, "copyToClipboardWithDelivery").mockResolvedValue({ ok: true, delivery: "copied" });
	const h = harness();
	h.changeContent("π🚀");
	const pending = h.controller.handleDumpCommand();
	await waitFor(() => h.text().includes("Review conversation copy"));
	expect(h.text()).toContain("6 UTF-8 bytes");
	expect(h.text()).not.toContain("π🚀");
	h.input("\r");
	await pending;
	expect(copy).not.toHaveBeenCalled();
});

test.each([
	["last", "Synthetic conversation"],
	["code", "second"],
	["all", "first\n\nsecond"],
	["link", "https://example.test/target"],
	["cmd", "echo synthetic"],
])("typed /copy %s uses the reviewed clipboard adapter", async (sub, expected) => {
	const copy = vi.spyOn(clipboard, "copyToClipboardWithDelivery").mockResolvedValue({ ok: true, delivery: "copied" });
	const h = harness();
	if (sub === "code" || sub === "all") h.changeContent("```text\nfirst\n```\n```text\nsecond\n```");
	if (sub === "link") h.changeContent("[Synthetic target](https://example.test/target)");
	const pending = h.controller.handleCopyCommand(sub);
	await waitFor(() => h.text().includes("Review clipboard copy"));
	expect(copy).not.toHaveBeenCalled();
	h.input("\x1b[B");
	h.input("\r");
	await pending;
	expect(copy).toHaveBeenCalledWith(expected);
});

test("typed copy re-resolves changed source text for a renewed Cancel-first review", async () => {
	const copy = vi.spyOn(clipboard, "copyToClipboardWithDelivery").mockResolvedValue({ ok: true, delivery: "copied" });
	const h = harness();
	const pending = h.controller.handleCopyCommand("last");
	await waitFor(() => h.text().includes("Review clipboard copy"));
	h.changeContent();
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("proposal changed"));
	h.input("\r");
	await pending;
	expect(copy).not.toHaveBeenCalled();
});

test("dump reviews clipboard replacement and defaults to Cancel", async () => {
	const copy = vi.spyOn(clipboard, "copyToClipboardWithDelivery").mockResolvedValue({ ok: true, delivery: "copied" });
	const h = harness();
	const pending = h.controller.handleDumpCommand();
	await waitFor(() => h.text().includes("Review conversation copy"));
	expect(h.text()).toContain("synthetic-session");
	expect(h.text()).toContain("clipboard");
	if (process.platform === "linux") expect(h.text()).toContain("Linux: clipboard text may disappear");
	expect(copy).not.toHaveBeenCalled();
	h.input("\r");
	await pending;
	expect(copy).not.toHaveBeenCalled();
	expect(h.ctx.showStatus).not.toHaveBeenCalled();
});

test.each(["copied", "requested"] as const)(
	"dump waits for clipboard %s and rejects duplicate commands",
	async delivery => {
		const completion = Promise.withResolvers<clipboard.ClipboardDeliveryResult>();
		const copy = vi.spyOn(clipboard, "copyToClipboardWithDelivery").mockImplementation(() => completion.promise);
		const h = harness();
		const pending = h.controller.handleDumpCommand();
		await waitFor(() => h.text().includes("Review conversation copy"));
		h.input("\x1b[B");
		h.input("\r");
		await waitFor(() => copy.mock.calls.length === 1);
		await h.controller.handleDumpCommand();
		h.input("\x1b");
		h.input("\x03");
		expect(copy).toHaveBeenCalledTimes(1);
		expect(h.text()).toContain("Applying conversation copy");
		expect(h.ctx.showStatus).not.toHaveBeenCalled();
		completion.resolve({ ok: true, delivery });
		await pending;
		if (delivery === "copied")
			expect(h.ctx.showStatus).toHaveBeenCalledWith("Conversation copied to the local clipboard.");
		else {
			expect(h.ctx.showStatus).not.toHaveBeenCalled();
			expect(h.ctx.showWarning).toHaveBeenCalledWith(
				"Clipboard request sent to the terminal; delivery cannot be verified.",
			);
		}
	},
);

test.each(["content", "session"])("dump revalidates its %s before copying", async drift => {
	const copy = vi.spyOn(clipboard, "copyToClipboardWithDelivery").mockResolvedValue({ ok: true, delivery: "copied" });
	const h = harness();
	const pending = h.controller.handleDumpCommand();
	await waitFor(() => h.text().includes("Review conversation copy"));
	if (drift === "content") h.changeContent();
	else h.changeSession();
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes(drift === "content" ? "proposal changed" : "target changed"));
	h.input("\r");
	await pending;
	expect(copy).not.toHaveBeenCalled();
});

test.each([false, true])("failed dump retains an unresolved result (retry: %s)", async retry => {
	const copy = vi
		.spyOn(clipboard, "copyToClipboardWithDelivery")
		.mockResolvedValueOnce({ ok: false, error: "Synthetic clipboard unavailable" })
		.mockResolvedValue({ ok: true, delivery: "copied" });
	const h = harness();
	const pending = h.controller.handleDumpCommand();
	await waitFor(() => h.text().includes("Review conversation copy"));
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("Unresolved conversation copy"));
	expect(h.ctx.showStatus).not.toHaveBeenCalled();
	expect(h.text()).toContain("Synthetic clipboard unavailable");
	if (retry) h.input("\x1b[B");
	h.input("\r");
	await pending;
	expect(copy).toHaveBeenCalledTimes(retry ? 2 : 1);
	if (retry) expect(h.ctx.showStatus).toHaveBeenCalledWith("Conversation copied to the local clipboard.");
	else
		expect(h.ctx.showError).toHaveBeenCalledWith(
			"Clipboard delivery remains unresolved. Open /dump to review and retry.",
		);
});
