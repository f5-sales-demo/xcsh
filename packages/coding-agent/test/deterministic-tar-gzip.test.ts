import { describe, expect, it } from "bun:test";
import { gunzipSync } from "node:zlib";
import { createDeterministicTarGzip } from "../../../scripts/deterministic-tar-gzip";

const encoder = new TextEncoder();

describe("createDeterministicTarGzip", () => {
	it("produces a stable, sorted archive without wall-clock metadata", async () => {
		const first = createDeterministicTarGzip([
			{ path: "nested/b.txt", bytes: encoder.encode("bravo") },
			{ path: "a.txt", bytes: encoder.encode("alpha") },
		]);
		const second = createDeterministicTarGzip([
			{ path: "a.txt", bytes: encoder.encode("alpha") },
			{ path: "nested/b.txt", bytes: encoder.encode("bravo") },
		]);

		expect(first).toEqual(second);
		const tar = gunzipSync(first);
		expect(tar.subarray(136, 148).toString("ascii")).toBe("00000000000\0");

		const files = await new Bun.Archive(first).files();
		expect(await files.get("a.txt")?.text()).toBe("alpha");
		expect(await files.get("nested/b.txt")?.text()).toBe("bravo");
	});

	it("rejects paths that can escape the extraction root", () => {
		expect(() => createDeterministicTarGzip([{ path: "../outside.txt", bytes: encoder.encode("blocked") }])).toThrow(
			"Invalid archive path",
		);
	});
});
