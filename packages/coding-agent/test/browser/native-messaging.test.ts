import { describe, expect, it } from "bun:test";
import { decodeNm, encodeNm } from "@f5-sales-demo/xcsh/browser/native-messaging";

describe("native-messaging framing", () => {
	it("round-trips a message", () => {
		const f = encodeNm({ type: "ping", id: "1" });
		const { messages, rest } = decodeNm(f);
		expect(messages).toEqual([{ type: "ping", id: "1" }]);
		expect(rest.length).toBe(0);
	});
	it("uses a 4-byte little-endian length prefix", () => {
		const f = encodeNm({}); // JSON "{}" = 2 bytes
		expect(Array.from(f.slice(0, 4))).toEqual([2, 0, 0, 0]);
	});
	it("decodes two concatenated frames and keeps a partial tail", () => {
		const a = encodeNm({ a: 1 });
		const b = encodeNm({ b: 2 });
		const joined = new Uint8Array([...a, ...b.slice(0, 3)]);
		const { messages, rest } = decodeNm(joined);
		expect(messages).toEqual([{ a: 1 }]);
		expect(rest.length).toBe(3);
	});
});
