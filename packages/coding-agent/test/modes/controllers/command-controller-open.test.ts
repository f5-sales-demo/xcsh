import { beforeAll, describe, expect, it, vi } from "bun:test";
import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import type { Component } from "@f5-sales-demo/pi-tui";
import { registerLocales } from "@f5-sales-demo/pi-utils";
import { locales } from "../../../src/locales";
import { CommandController } from "../../../src/modes/controllers/command-controller";
import { setTheme } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";

registerLocales(locales);
beforeAll(async () => setTheme("xcsh-dark"));

function user(content: string): AgentMessage {
	return { role: "user", content, timestamp: 1 };
}

function harness(messages: AgentMessage[]) {
	let currentMessages = messages;
	let component: Component | undefined;
	const showError = vi.fn();
	const showWarning = vi.fn();
	const showStatus = vi.fn();
	const session = {
		get messages() {
			return currentMessages;
		},
	};
	const ctx = {
		session,
		sessionManager: { getSessionId: () => "open-session" },
		showError,
		showWarning,
		showStatus,
		showHookCustom: (factory: any) =>
			new Promise(resolve => {
				component = factory({ terminal: { rows: 32 }, requestRender() {} }, {}, {}, resolve);
			}),
	} as unknown as InteractiveModeContext;
	const controller = new CommandController(ctx);
	return {
		controller,
		showError,
		showWarning,
		showStatus,
		text: () => (component ? Bun.stripANSI(component.render(100).join("\n")) : ""),
		input: (key: string) => component?.handleInput?.(key),
		setMessages: (next: AgentMessage[]) => {
			currentMessages = next;
		},
	};
}

async function waitFor(predicate: () => boolean) {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) return;
		await Bun.sleep(5);
	}
	throw new Error("Open-link review state not reached");
}

describe("CommandController /open", () => {
	it("rejects arguments without invoking the opener", async () => {
		const state = harness([user("https://example.test/latest")]);
		const opener = vi.spyOn(state.controller, "openHttpUrl");
		await state.controller.handleOpenCommand("/tmp/file");
		expect(opener).not.toHaveBeenCalled();
		expect(state.showError).toHaveBeenCalledWith("Usage: /open");
	});

	it.each([false, true])("reviews only the latest transcript HTTP(S) link (confirm: %s)", async confirm => {
		const state = harness([
			user("[file](file:///tmp/no) [old](https://example.test/old)"),
			user("javascript:alert(1) then https://example.test/latest"),
		]);
		const opener = vi.spyOn(state.controller, "openHttpUrl").mockResolvedValue({ ok: true });
		const pending = state.controller.handleOpenCommand("");
		await waitFor(() => state.text().includes("Review external link"));
		expect(state.text()).toContain("https://example.test/latest");
		expect(state.text()).toContain("https://example.test");
		expect(opener).not.toHaveBeenCalled();
		if (confirm) state.input("\x1b[B");
		state.input("\r");
		await pending;
		expect(opener).toHaveBeenCalledTimes(confirm ? 1 : 0);
		expect(state.showStatus).toHaveBeenCalledTimes(confirm ? 1 : 0);
	});

	it("revalidates the latest link and does not launch a changed target", async () => {
		const state = harness([user("https://example.test/original")]);
		const opener = vi.spyOn(state.controller, "openHttpUrl").mockResolvedValue({ ok: true });
		const pending = state.controller.handleOpenCommand("");
		await waitFor(() => state.text().includes("Review external link"));
		state.setMessages([user("https://example.test/changed")]);
		state.input("\x1b[B");
		state.input("\r");
		await waitFor(() => state.text().includes("proposal changed"));
		expect(opener).not.toHaveBeenCalled();
		state.input("\r");
		await pending;
	});

	it("rejects a duplicate review and keeps the first exact target", async () => {
		const state = harness([user("https://example.test/first")]);
		const opener = vi.spyOn(state.controller, "openHttpUrl").mockResolvedValue({ ok: true });
		const pending = state.controller.handleOpenCommand("");
		await waitFor(() => state.text().includes("Review external link"));
		state.setMessages([user("https://example.test/second")]);
		await state.controller.handleOpenCommand("");
		expect(state.showWarning).toHaveBeenCalledWith("Another link review or launch is already active.");
		expect(state.text()).toContain("https://example.test/first");
		expect(opener).not.toHaveBeenCalled();
		state.input("\r");
		await pending;
	});

	it("reports launcher failure as unresolved and retries the exact link", async () => {
		const state = harness([user("https://example.test/retry")]);
		const opener = vi
			.spyOn(state.controller, "openHttpUrl")
			.mockResolvedValueOnce({ ok: false, error: "Synthetic launcher failure" })
			.mockResolvedValueOnce({ ok: true });
		const pending = state.controller.handleOpenCommand("");
		await waitFor(() => state.text().includes("Review external link"));
		state.input("\x1b[B");
		state.input("\r");
		await waitFor(
			() => state.text().includes("Unresolved external link") && state.text().includes("Synthetic launcher failure"),
		);
		expect(state.showStatus).not.toHaveBeenCalled();
		state.input("\x1b[B");
		state.input("\r");
		await pending;
		expect(opener).toHaveBeenCalledTimes(2);
		expect(opener).toHaveBeenNthCalledWith(1, "https://example.test/retry");
		expect(opener).toHaveBeenNthCalledWith(2, "https://example.test/retry");
		expect(state.showStatus).toHaveBeenCalledTimes(1);
	});

	it("keeps arbitrary non-HTTP links closed", async () => {
		const state = harness([user("[file](file:///tmp/no) [script](javascript:alert(1))")]);
		const opener = vi.spyOn(state.controller, "openHttpUrl");
		await state.controller.handleOpenCommand();
		expect(opener).not.toHaveBeenCalled();
		expect(state.showWarning).toHaveBeenCalledWith("No HTTP(S) link found in the transcript.");
	});
});
