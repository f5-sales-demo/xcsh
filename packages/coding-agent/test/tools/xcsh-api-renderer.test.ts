import { describe, expect, it } from "bun:test";
import { getThemeByName } from "../../src/modes/theme/theme";
import { xcshApiToolRenderer } from "../../src/tools/xcsh-api-renderer";

function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("xcshApiToolRenderer.renderResult", () => {
	it("renders validation errors cleanly when details is undefined", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [
				{ type: "text", text: 'Validation failed: path is required\n\nReceived arguments:\n{"method":"GET"}' },
			],
			isError: true,
		};
		const component = xcshApiToolRenderer.renderResult(result as any, { expanded: false, isPartial: false }, theme!, {
			method: "GET",
		});
		const rendered = stripAnsi(component.render(120).join("\n"));
		// Should use the simple formatErrorMessage path (no box with Guidance section)
		expect(rendered).toContain("Error:");
		expect(rendered).toContain("Validation failed");
	});

	it("renders HTTP status 200 success responses with JSON body", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: '200 OK\n\n{"metadata":{"name":"test"}}' }],
			details: {
				status: 200,
				url: "https://api.example.com/api/config/namespaces/default/http_loadbalancers",
				method: "GET",
				requestId: "test-id",
			},
			isError: false,
		};
		const component = xcshApiToolRenderer.renderResult(result as any, { expanded: false, isPartial: false }, theme!, {
			method: "GET",
			path: "/api/config/namespaces/default/http_loadbalancers",
		});
		const rendered = stripAnsi(component.render(120).join("\n"));
		expect(rendered).toContain("200");
		expect(rendered).toContain("test");
	});

	it("handles HTTP/2 empty statusText (status line '200 ' trimmed to '200')", async () => {
		const theme = await getThemeByName("xcsh-dark");
		// HTTP/2 returns empty statusText — statusLine is "200 " which trims to "200"
		const result = {
			content: [{ type: "text", text: '200 \n\n{"metadata":{"name":"http2-test"}}' }],
			details: {
				status: 200,
				url: "https://api.example.com/api/config/namespaces/default/http_loadbalancers",
				method: "GET",
				requestId: "test-http2",
			},
			isError: false,
		};
		const component = xcshApiToolRenderer.renderResult(result as any, { expanded: false, isPartial: false }, theme!, {
			method: "GET",
			path: "/api/config/namespaces/default/http_loadbalancers",
		});
		const rendered = stripAnsi(component.render(120).join("\n"));
		// Should still parse JSON — the regex must handle "200" without trailing text
		expect(rendered).toContain("http2-test");
	});

	it("preserves full error text when first line is not an HTTP status", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "Error: Something went wrong\n\nMore details here" }],
			details: {
				status: 0,
				url: "",
				method: "GET",
				requestId: "test-err",
			},
			isError: true,
		};
		const component = xcshApiToolRenderer.renderResult(result as any, { expanded: false, isPartial: false }, theme!, {
			method: "GET",
			path: "/test",
		});
		const rendered = stripAnsi(component.render(120).join("\n"));
		// The "Error: Something went wrong" should NOT be stripped as a status line
		expect(rendered).toContain("Something went wrong");
	});

	it("renders error with guidance section for HTTP error responses", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [
				{
					type: "text",
					text: '404 Not Found\n\n{"code":5,"message":"not found"}\n\nResource not found in namespace',
				},
			],
			details: {
				status: 404,
				url: "https://api.example.com/api/config/namespaces/default/missing",
				method: "GET",
				requestId: "test-404",
			},
			isError: true,
		};
		const component = xcshApiToolRenderer.renderResult(result as any, { expanded: false, isPartial: false }, theme!, {
			method: "GET",
			path: "/api/config/namespaces/default/missing",
		});
		const rendered = stripAnsi(component.render(120).join("\n"));
		expect(rendered).toContain("404");
		expect(rendered).toContain("Guidance");
		expect(rendered).toContain("Resource not found");
	});
});
