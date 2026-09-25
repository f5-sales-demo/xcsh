import { beforeAll, describe, expect, it, vi } from "bun:test";
import { visibleWidth } from "@f5-sales-demo/pi-tui";
import { presentAuthLink } from "../../../src/modes/components/auth-link-presenter";
import { LoginDialogComponent } from "../../../src/modes/components/login-dialog";
import { initTheme } from "../../../src/modes/theme/theme";

const LONG_AUTH_URL =
	"https://login.example.test/authorize?client_id=synthetic-client&redirect_uri=https%3A%2F%2Flocalhost%2Fcallback&scope=openid%20profile&state=synthetic-state&code_challenge=synthetic-challenge";

beforeAll(() => {
	initTheme();
});

describe("LoginDialogComponent", () => {
	it("presents and opens the exact auth target without overwriting the clipboard", () => {
		const requestRender = vi.fn();
		const openUrl = vi.fn();
		const dialog = new LoginDialogComponent({ requestRender } as never, "synthetic-provider", vi.fn(), {
			openUrl,
			presentLink: (container, url) => presentAuthLink(container, url, { platform: "linux" }),
		});

		dialog.showAuth(LONG_AUTH_URL, "Complete the synthetic provider instructions.");

		let visible = Bun.stripANSI(dialog.render(28).join("\n")).replace(/\s+/g, " ").trim();
		expect(visible).toContain("Open sign-in page");
		expect(visible).toContain("Ctrl+click to open");
		for (let page = 0; page < 8 && !visible.includes("Complete the synthetic"); page++) {
			dialog.handleInput("\x1b[6~");
			visible = Bun.stripANSI(dialog.render(28).join("\n")).replace(/\s+/g, " ").trim();
		}
		expect(visible).toContain("Complete the synthetic");
		expect(visible).toContain("provider instructions.");
		expect(visible).not.toContain(LONG_AUTH_URL);
		expect(openUrl).toHaveBeenCalledTimes(1);
		expect(openUrl).toHaveBeenCalledWith(LONG_AUTH_URL);
		expect(requestRender).toHaveBeenCalledTimes(1);
	});

	it("displays the hosted URL while opening the automatic loopback URL", () => {
		const requestRender = vi.fn();
		const openUrl = vi.fn();
		const displayedUrl = `${LONG_AUTH_URL}&route=hosted`;
		const automaticUrl = `${LONG_AUTH_URL}&route=loopback`;
		const dialog = new LoginDialogComponent({ requestRender } as never, "anthropic", vi.fn(), {
			openUrl,
			presentLink: (container, url) => presentAuthLink(container, url, { platform: "linux" }),
		});

		dialog.showAuth(displayedUrl, undefined, automaticUrl);

		expect(openUrl).toHaveBeenCalledWith(automaticUrl);
	});

	it("keeps recovery instructions visible when browser launch fails", async () => {
		const requestRender = vi.fn();
		const dialog = new LoginDialogComponent({ requestRender } as never, "synthetic-provider", vi.fn(), {
			openUrl: vi.fn(async () => ({ ok: false as const, error: "launcher unavailable" })),
			presentLink: (container, url) => presentAuthLink(container, url, { platform: "linux" }),
		});
		dialog.showAuth(LONG_AUTH_URL, "Paste the authorization code manually.");
		await Bun.sleep(0);
		const visible = Bun.stripANSI(dialog.render(200).join("\n"));
		expect(visible).toContain("Open sign-in page");
		expect(visible).toContain("Paste the authorization code manually.");
		expect(visible).toContain("Could not open browser: launcher unavailable");
		expect(requestRender).toHaveBeenCalled();
	});

	for (const width of [40, 100]) {
		it(`wraps and reconstructs every login message at width ${width}`, async () => {
			const requestRender = vi.fn();
			const onComplete = vi.fn();
			const dialog = new LoginDialogComponent(
				{ requestRender, terminal: { rows: 40 } } as never,
				"synthetic-provider",
				onComplete,
				{
					openUrl: vi.fn(async () => ({
						ok: false as const,
						error: "synthetic launcher café 東京 unavailable after every recovery attempt",
					})),
					presentLink: (container, url) => presentAuthLink(container, url, { platform: "linux" }),
				},
			);
			const instructions =
				"Complete the ANSI café 東京 authentication instructions without skipping any synthetic provider recovery step.";
			dialog.showAuth(LONG_AUTH_URL, `\u001b[33m${instructions}\u001b[39m`);
			dialog.showWaiting(
				"Wait while the ANSI café 東京 provider verifies every synthetic authentication checkpoint.",
			);
			dialog.showProgress(
				"Checking the ANSI café 東京 synthetic provider response without losing any status words.",
			);
			const manualPrompt =
				"Paste the ANSI café 東京 synthetic authorization response after reviewing every recovery instruction.";
			const manualInput = dialog.showManualInput(manualPrompt);
			await Bun.sleep(0);

			const pages: string[] = [];
			for (let page = 0; page < 12; page += 1) {
				const rendered = dialog.render(width);
				expect(rendered.every(line => visibleWidth(line) === width)).toBe(true);
				pages.push(
					rendered
						.map(line => Bun.stripANSI(line).slice(1, -1).trim())
						.join(" ")
						.replace(/\s+/g, " "),
				);
				dialog.handleInput("\x1b[6~");
			}
			const reconstructed = pages.join(" ");
			expect(reconstructed).toContain(
				"Complete provider authentication; credentials are handled by the provider flow and are never displayed here.",
			);
			expect(reconstructed).toContain(instructions);
			expect(reconstructed).toContain(
				"Wait while the ANSI café 東京 provider verifies every synthetic authentication checkpoint.",
			);
			expect(reconstructed).toContain(
				"Checking the ANSI café 東京 synthetic provider response without losing any status words.",
			);
			expect(reconstructed).toContain(
				"Could not open browser: synthetic launcher café 東京 unavailable after every recovery attempt",
			);
			expect(reconstructed).toContain(manualPrompt);
			expect(reconstructed).not.toContain("…");
			for (const character of "synthetic-code") dialog.handleInput(character);
			dialog.handleInput("\r");
			await expect(manualInput).resolves.toBe("synthetic-code");
			expect(onComplete).not.toHaveBeenCalled();
		});
	}

	it("keeps cancellation wired while manual input is focused", async () => {
		const onComplete = vi.fn();
		const dialog = new LoginDialogComponent(
			{ requestRender: vi.fn(), terminal: { rows: 24 } } as never,
			"synthetic-provider",
			onComplete,
		);
		const pending = dialog.showManualInput("Paste a synthetic authorization response.");
		dialog.handleInput("\x1b");
		await expect(pending).rejects.toThrow("Login cancelled");
		expect(onComplete).toHaveBeenCalledWith(false, "Login cancelled");
		expect(dialog.signal.aborted).toBe(true);
	});
});
