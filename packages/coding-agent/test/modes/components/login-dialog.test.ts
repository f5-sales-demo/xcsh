import { beforeAll, describe, expect, it, vi } from "bun:test";
import { presentAuthLink } from "../../../src/modes/components/auth-link-presenter";
import { LoginDialogComponent } from "../../../src/modes/components/login-dialog";
import { initTheme } from "../../../src/modes/theme/theme";

const LONG_AUTH_URL =
	"https://login.example.test/authorize?client_id=synthetic-client&redirect_uri=https%3A%2F%2Flocalhost%2Fcallback&scope=openid%20profile&state=synthetic-state&code_challenge=synthetic-challenge";

beforeAll(() => {
	initTheme();
});

describe("LoginDialogComponent", () => {
	it("presents and copies the exact auth target without visibly rendering it", () => {
		const requestRender = vi.fn();
		const openUrl = vi.fn();
		const copy = vi.fn(async () => undefined);
		const dialog = new LoginDialogComponent({ requestRender } as never, "synthetic-provider", vi.fn(), {
			openUrl,
			presentLink: (container, url) => presentAuthLink(container, url, { copy, platform: "linux" }),
		});

		dialog.showAuth(LONG_AUTH_URL, "Complete the synthetic provider instructions.");

		const visible = Bun.stripANSI(dialog.render(28).join("\n")).replace(/\s+/g, " ").trim();
		expect(visible).toContain("Open sign-in page");
		expect(visible).toContain("Ctrl+click to open");
		expect(visible).toContain("Complete the synthetic provider instructions.");
		expect(visible).not.toContain(LONG_AUTH_URL);
		expect(copy).toHaveBeenCalledTimes(1);
		expect(copy).toHaveBeenCalledWith(LONG_AUTH_URL);
		expect(openUrl).toHaveBeenCalledTimes(1);
		expect(openUrl).toHaveBeenCalledWith(LONG_AUTH_URL);
		expect(requestRender).toHaveBeenCalledTimes(1);
	});
});
