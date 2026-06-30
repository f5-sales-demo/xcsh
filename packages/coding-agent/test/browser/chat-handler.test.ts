import { describe, expect, it } from "bun:test";
import { composeChatPrompt } from "@f5-sales-demo/xcsh/browser/chat-handler";
import type { PageContextSnapshot } from "@f5-sales-demo/xcsh/browser/chat-protocol";

describe("composeChatPrompt", () => {
	it("includes mode instruction and user text", () => {
		const result = composeChatPrompt("what is this?", null, "educational");
		expect(result).toContain("[Chat mode: educational]");
		expect(result).toContain("Explain concepts");
		expect(result).toContain("what is this?");
	});

	it("includes page context when provided", () => {
		const context: PageContextSnapshot = {
			v: 1,
			capturedAt: 1719000000000,
			tabId: 1,
			url: "https://tenant.console.ves.volterra.io/web/ns/default/http_loadbalancers/my-lb",
			path: "/web/ns/default/http_loadbalancers/my-lb",
			title: "my-lb — Distributed Cloud",
			ax: null,
			api: {
				url: "/api/config/namespaces/default/http_loadbalancers/my-lb",
				status: 200,
				resourceType: "http_loadbalancers",
				body: { name: "my-lb", namespace: "default" },
				truncated: false,
			},
			truncated: false,
		};
		const result = composeChatPrompt("explain this LB", context, "educational");
		expect(result).toContain("URL: https://tenant.console.ves.volterra.io");
		expect(result).toContain("Title: my-lb");
		expect(result).toContain("http_loadbalancers");
		expect(result).toContain('"name": "my-lb"');
		expect(result).toContain("explain this LB");
	});

	it("handles all five interaction modes", () => {
		const modes = ["educational", "presentation", "configuration", "screenshot", "annotation"] as const;
		for (const mode of modes) {
			const result = composeChatPrompt("test", null, mode);
			expect(result).toContain(`[Chat mode: ${mode}]`);
		}
	});

	it("notes truncation when flags are set", () => {
		const context: PageContextSnapshot = {
			v: 1,
			capturedAt: 1719000000000,
			tabId: 1,
			url: "https://example.com",
			path: "/",
			title: "Test",
			ax: null,
			api: { url: "/api/test", status: 200, resourceType: "test", body: {}, truncated: true },
			truncated: true,
		};
		const result = composeChatPrompt("hi", context, "configuration");
		expect(result).toContain("[API body was truncated]");
		expect(result).toContain("[Page context was truncated]");
	});

	it("handles null api and ax gracefully", () => {
		const context: PageContextSnapshot = {
			v: 1,
			capturedAt: 1719000000000,
			tabId: 1,
			url: "https://example.com",
			path: "/",
			title: "Test",
			ax: null,
			api: null,
			truncated: false,
		};
		const result = composeChatPrompt("hi", context, "presentation");
		expect(result).toContain("URL: https://example.com");
		expect(result).not.toContain("API resource");
		expect(result).not.toContain("Accessibility tree");
	});
});
