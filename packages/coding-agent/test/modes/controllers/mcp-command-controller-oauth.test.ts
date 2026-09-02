import { beforeAll, describe, expect, it, vi } from "bun:test";
import { presentAuthLink } from "../../../src/modes/components/auth-link-presenter";
import { showMcpOAuthAuthorization } from "../../../src/modes/controllers/mcp-command-controller";
import { initTheme } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";

const LONG_AUTH_URL =
	"https://login.example.test/authorize?client_id=synthetic-client&redirect_uri=https%3A%2F%2Flocalhost%2Fcallback&scope=openid%20profile&state=synthetic-state&code_challenge=synthetic-challenge";

beforeAll(() => {
	initTheme();
});

describe("MCPCommandController OAuth presentation", () => {
	it("uses the shared short link, preserves instructions, and opens the exact URL", () => {
		const addedComponents: Array<{ render(width: number): string[] }> = [];
		const openUrl = vi.fn();
		const copy = vi.fn(async () => undefined);
		const ctx = {
			chatContainer: {
				addChild: (component: { render(width: number): string[] }) => addedComponents.push(component),
			},
			ui: { requestRender: vi.fn() },
		} as unknown as InteractiveModeContext;

		showMcpOAuthAuthorization(
			ctx,
			{ url: LONG_AUTH_URL, instructions: "Approve the synthetic MCP request." },
			{
				openUrl,
				presentLink: (container, url) => presentAuthLink(container, url, { copy, platform: "linux" }),
			},
		);

		const visible = Bun.stripANSI(addedComponents.flatMap(component => component.render(32)).join("\n"))
			.replace(/\s+/g, " ")
			.trim();
		expect(visible).toContain("OAuth Authorization Required");
		expect(visible).toContain("Open sign-in page");
		expect(visible).toContain("Approve the synthetic MCP request.");
		expect(visible).toContain("Waiting for authorization");
		expect(visible).not.toContain(LONG_AUTH_URL);
		expect(copy).toHaveBeenCalledTimes(1);
		expect(copy).toHaveBeenCalledWith(LONG_AUTH_URL);
		expect(openUrl).toHaveBeenCalledTimes(1);
		expect(openUrl).toHaveBeenCalledWith(LONG_AUTH_URL);
		expect(ctx.ui.requestRender).toHaveBeenCalled();
	});
});
