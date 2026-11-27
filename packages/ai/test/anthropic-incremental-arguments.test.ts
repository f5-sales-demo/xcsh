import { expect, it } from "bun:test";
import { StreamingJsonParser, ToolCallArgumentsStream } from "../src/utils/streaming-json";

it("keeps partial snapshots immutable while nested arguments grow", () => {
	const parser = new StreamingJsonParser();
	parser.append('{"name":"hel');
	const first = parser.snapshot();
	parser.append('lo","items":[1,2]}');
	expect(first).toEqual({ name: "hel" });
	expect(parser.snapshot()).toEqual({ name: "hello", items: [1, 2] });
});
it("preserves large streamed strings, nested values, escapes, Unicode and proto keys", () => {
	const value = JSON.parse('{"__proto__":{"safe":true},"text":""}');
	value.text = 'quote=" 漢字 🚀 \\'.repeat(120000);
	value.nested = { items: [1, { ok: true }] };
	const encoded = JSON.stringify(value);
	const stream = new ToolCallArgumentsStream();
	for (let start = 0; start < encoded.length; start += 4096) stream.append(encoded.slice(start, start + 4096));
	expect(stream.finish().arguments).toEqual(value);
	expect(({} as any).safe).toBeUndefined();
});
it("rejects truncated and non-object terminal inputs", () => {
	const stream = new ToolCallArgumentsStream();
	stream.append('{"unfinished":');
	expect(() => stream.finish()).toThrow();
	const array = new ToolCallArgumentsStream();
	array.append("[1,2]");
	expect(() => array.finish()).toThrow();
});
