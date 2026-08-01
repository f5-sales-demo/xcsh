import { describe, expect, it } from "bun:test";
import { composeChatPrompt, KEEPALIVE_INTERVAL_MS, shouldSendKeepalive } from "../../src/browser/chat-handler";
import type { PageContextSnapshot } from "../../src/browser/chat-protocol";
import { classifyReferenceKind } from "../../src/references";

describe("composeChatPrompt", () => {
	it("includes mode instruction and user text", () => {
		const result = composeChatPrompt("what is this?", null, "educational", null);
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
		const result = composeChatPrompt("explain this LB", context, "educational", null);
		expect(result).toContain("URL: https://tenant.console.ves.volterra.io");
		expect(result).toContain("Title: my-lb");
		expect(result).toContain("http_loadbalancers");
		expect(result).toContain('"name": "my-lb"');
		expect(result).toContain("explain this LB");
	});

	it("handles all five interaction modes", () => {
		const modes = ["educational", "presentation", "configuration", "screenshot", "annotation"] as const;
		for (const mode of modes) {
			const result = composeChatPrompt("test", null, mode, null);
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
		const result = composeChatPrompt("hi", context, "configuration", null);
		expect(result).toContain("[API body was truncated]");
		expect(result).toContain("[Page context was truncated]");
	});

	it("handles null resourceType gracefully", () => {
		const context: PageContextSnapshot = {
			v: 1,
			capturedAt: 1719000000000,
			tabId: 1,
			url: "https://example.com",
			path: "/",
			title: "Test",
			ax: null,
			api: { url: "/api/test", status: 200, resourceType: null, body: {}, truncated: false },
			truncated: false,
		};
		const result = composeChatPrompt("hi", context, "educational", null);
		expect(result).toContain("unknown, status 200");
		expect(result).not.toContain("null");
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
		const result = composeChatPrompt("hi", context, "presentation", null);
		expect(result).toContain("URL: https://example.com");
		// When api/ax are null, the PER-TURN context sections should not appear
		// (the system prompt mentions "API resource" generically — that's fine).
		expect(result).not.toContain("API resource (");
		expect(result).not.toContain("Accessibility tree:");
	});

	it("host 'chrome' is identical to a null host (browser prompt + mode line)", () => {
		const chrome = composeChatPrompt("hi", null, "educational", "chrome");
		const legacy = composeChatPrompt("hi", null, "educational", null);
		expect(chrome).toBe(legacy);
		expect(chrome).toContain("Chrome side panel");
		expect(chrome).toContain("[Chat mode: educational]");
	});

	it("host 'excel' uses the Excel document prompt, no Chrome text, no mode line", () => {
		const result = composeChatPrompt("sum column B", null, "educational", "excel");
		expect(result).toContain("Microsoft Excel");
		expect(result).toContain("workbook");
		expect(result).toContain("sum column B");
		// Document hosts get NO Chrome self-awareness and NO browser interaction mode.
		expect(result).not.toContain("Chrome");
		expect(result).not.toContain("[Chat mode:");
		expect(result).not.toContain("catalog_workflow_runner");
	});

	it("document hosts drop the page-context block even when a context is passed", () => {
		const context: PageContextSnapshot = {
			v: 1,
			capturedAt: 1719000000000,
			tabId: 1,
			url: "https://example.com",
			path: "/",
			title: "Test",
			ax: null,
			api: { url: "/api/test", status: 200, resourceType: "test", body: { a: 1 }, truncated: false },
			truncated: false,
		};
		const result = composeChatPrompt("hi", context, "educational", "word");
		expect(result).toContain("Microsoft Word");
		// The Chrome-only page-context sections must NOT be injected for a document host.
		expect(result).not.toContain("[Page context —");
		expect(result).not.toContain("URL: https://example.com");
		expect(result).not.toContain("[Chat mode:");
	});

	it("powerpoint uses the PowerPoint document prompt", () => {
		const result = composeChatPrompt("tidy slide 3", null, "presentation", "powerpoint");
		expect(result).toContain("Microsoft PowerPoint");
		expect(result).toContain("presentation");
		expect(result).not.toContain("Chrome");
		expect(result).not.toContain("[Chat mode:");
	});
});

describe("classifyReferenceKind", () => {
	it("classifies console.ves.volterra.io as console", () => {
		expect(classifyReferenceKind("https://tenant.console.ves.volterra.io/web/ns/default/http_loadbalancers")).toBe(
			"console",
		);
	});

	it("classifies docs.cloud.f5.com as doc", () => {
		expect(classifyReferenceKind("https://docs.cloud.f5.com/docs/how-to/app-networking")).toBe("doc");
	});

	it("classifies /docs paths as doc", () => {
		expect(classifyReferenceKind("https://example.com/docs/reference/api")).toBe("doc");
	});

	it("defaults unknown URLs to doc", () => {
		expect(classifyReferenceKind("https://github.com/f5-sales-demo/xcsh")).toBe("doc");
	});
});

describe("shouldSendKeepalive (chat_keepalive throttle, #1994)", () => {
	it("sends the first keepalive immediately (lastKeepaliveAt = 0)", () => {
		expect(shouldSendKeepalive(Date.now(), 0)).toBe(true);
	});
	it("suppresses a keepalive within the interval", () => {
		expect(shouldSendKeepalive(9_999, 0)).toBe(false);
		expect(shouldSendKeepalive(25_000, 20_000)).toBe(false);
	});
	it("sends again once the interval has elapsed", () => {
		expect(shouldSendKeepalive(KEEPALIVE_INTERVAL_MS, 0)).toBe(true);
		expect(shouldSendKeepalive(35_000, 20_000)).toBe(true);
	});
});
