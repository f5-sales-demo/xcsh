import { expect, test } from "bun:test";
import { Settings } from "../../src/config/settings";
import { ReadTool } from "../../src/tools/read";
import { terraformReadEnvelope } from "../../src/tools/terraform-read-envelope";

const text = (result: { content: Array<{ type: string; text?: string }> }) =>
	result.content.find(part => part.type === "text")?.text;
const resultBytes = (result: unknown) => Buffer.byteLength(JSON.stringify(result));
test("discovery retries complete candidates with unchanged query and filters", async () => {
	const seen: string[] = [];
	const url = "xcsh://terraform-documentation/?search=name&provider_type=resources&node=root&cursor=next";
	const result = await terraformReadEnvelope(url, async uri => {
		seen.push(uri);
		const u = new URL(uri);
		return {
			url: uri,
			content:
				u.searchParams.get("limit") === "1"
					? "Provider: v1.0.0\nRead: exact-leaf\nComplete candidate"
					: '"'.repeat(3000),
			contentType: "text/markdown",
		};
	});
	expect(resultBytes(result)).toBeLessThanOrEqual(4096 - 512);
	expect(seen.map(uri => new URL(uri).searchParams.get("limit"))).toEqual([null, "2", "1"]);
	for (const uri of seen) {
		const u = new URL(uri);
		expect(u.searchParams.get("search")).toBe("name");
		expect(u.searchParams.get("node")).toBe("root");
		expect(u.searchParams.get("cursor")).toBe("next");
	}
	expect(text(result)).toContain("Complete candidate");
});
test("context envelope preserves fences or returns an explicit complete-read destination", async () => {
	const uri = "xcsh://terraform-documentation/documentation/resources/fixture/index.md?view=context#schema-name";
	const body = 'Provider: v1.0.0\n```hcl\nname = "synthetic"\n```';
	const complete = await terraformReadEnvelope(uri, async () => ({
		url: uri,
		content: body,
		contentType: "text/markdown",
	}));
	expect(text(complete)).toBe(body);
	const large = await terraformReadEnvelope(uri, async () => ({
		url: uri,
		content: body.repeat(1000),
		contentType: "text/markdown",
	}));
	expect(resultBytes(large)).toBeLessThanOrEqual(16384 - 512);
	expect(text(large)).toContain("Oversized section:");
	expect(text(large)).toContain("?view=full#schema-name");
});
test("unlimited exact reads retain complete content and discovery cannot loop at limit one", async () => {
	const uri = "xcsh://terraform-documentation/documentation/resources/fixture/index.md#schema-name";
	const content = "x".repeat(40000);
	const full = await terraformReadEnvelope(uri, async () => ({ url: uri, content, contentType: "text/markdown" }));
	expect(text(full)).toBe(content);
	let calls = 0;
	const root = "xcsh://terraform-documentation/?search=field&limit=1";
	const bounded = await terraformReadEnvelope(root, async () => {
		calls++;
		return { url: root, content, contentType: "text/markdown" };
	});
	expect(calls).toBe(1);
	expect(resultBytes(bounded)).toBeLessThan(4096);
	expect(text(bounded)).toContain("Refine the query");
});

test("first resolver call preserves malformed raw paths for canonical rejection", async () => {
	for (const path of [
		"/documentation/resources/../fixture/index.md?view=context",
		"/documentation/resources/%2e%2e/fixture/index.md?view=context",
	]) {
		const request = "xcsh://terraform-documentation" + path;
		let seen = "";
		await expect(
			terraformReadEnvelope(request, async uri => {
				seen = uri;
				throw Error("unsafe raw path");
			}),
		).rejects.toThrow("unsafe raw path");
		expect(seen).toBe(request);
	}
});

test("read tool returns complete unpaginated Terraform exact content beyond generic limits", async () => {
	const content = "Complete property section\n".repeat(4000);
	const tool = new ReadTool({
		cwd: process.cwd(),
		hasUI: false,
		hasEditTool: true,
		getSessionFile: () => null,
		getSessionSpawns: () => null,
		settings: Settings.isolated({}),
		internalRouter: {
			canHandle: () => true,
			resolve: async (uri: string) => ({ url: uri, content, contentType: "text/markdown" }),
		},
	} as any);
	for (const uri of [
		"xcsh://terraform-documentation/documentation/resources/fixture/index.md#schema-name",
		"xcsh://terraform-documentation/documentation/resources/fixture/index.md?view=full#schema-name",
	]) {
		const result = await tool.execute("exact", { path: uri });
		expect(text(result)).toBe(content);
	}
});
