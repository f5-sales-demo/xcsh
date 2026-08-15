import { expect, test } from "bun:test";
import { Markdown, type MarkdownMediaResolver } from "../src/components/markdown";
import { defaultMarkdownTheme } from "./test-themes";

function png(width = 3, height = 2): string {
	const value = Buffer.alloc(24);
	value.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	value.writeUInt32BE(width, 16);
	value.writeUInt32BE(height, 20);
	return value.toString("base64");
}

test("Markdown resolves image nodes asynchronously and preserves their position", async () => {
	let resolveRefresh: (() => void) | undefined;
	const refreshed = new Promise<void>(resolve => {
		resolveRefresh = resolve;
	});
	const calls: string[] = [];
	const resolver: MarkdownMediaResolver = async request => {
		calls.push(request.source);
		await Promise.resolve();
		return { id: "media_aaaaaaaaaaaaaaaaaaaaaaaa", data: png(), mimeType: "image/png", filename: request.alt };
	};
	const markdown = new Markdown(
		"before\n\n![diagram](artifact://7)\n\nafter",
		0,
		0,
		defaultMarkdownTheme,
		undefined,
		2,
		{ resolve: resolver, onInvalidate: () => resolveRefresh?.() },
	);

	expect(markdown.render(80).join("\n")).toContain("Loading media: diagram");
	await refreshed;
	const rendered = markdown.render(80).join("\n");
	expect(rendered.indexOf("before")).toBeLessThan(rendered.indexOf("[Image: diagram [image/png] 3x2]"));
	expect(rendered.indexOf("[Image: diagram [image/png] 3x2]")).toBeLessThan(rendered.indexOf("after"));
	expect(calls).toEqual(["artifact://7"]);
	expect(markdown.render(80).join("\n")).toContain("[Image: diagram [image/png] 3x2]");
	expect(calls).toHaveLength(1);
});

test("Markdown reports resolver failures without retrying each render", async () => {
	let refresh: (() => void) | undefined;
	const refreshed = new Promise<void>(resolve => {
		refresh = resolve;
	});
	let calls = 0;
	const markdown = new Markdown("![bad](https://example.com/bad)", 0, 0, defaultMarkdownTheme, undefined, 2, {
		resolve: async () => {
			calls++;
			throw new Error("MIME mismatch");
		},
		onInvalidate: () => refresh?.(),
	});
	markdown.render(80);
	await refreshed;
	expect(markdown.render(80).join("\n")).toContain("Media unavailable: MIME mismatch");
	markdown.render(80);
	expect(calls).toBe(1);
});
