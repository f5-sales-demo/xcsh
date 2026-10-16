import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { recoverPinnedIndex } from "../../../../scripts/recover-prebuilt-npm-index";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const gzip = gzipSync(Buffer.from("synthetic immutable SQLite bytes"));
const binary = Buffer.concat([
	Buffer.from("synthetic native prefix"),
	gzipSync(Buffer.from("unrelated asset")),
	gzip,
	Buffer.from("suffix"),
]);
const identity = { commit: "a".repeat(40), version: "23.5.0", runId: "123" };
const provenance = {
	schemaVersion: 1,
	platform: "linux",
	arch: "x64",
	version: identity.version,
	source: { repository: "f5-sales-demo/xcsh", commit: identity.commit, workflow: "ci.yml", runId: identity.runId },
	binary: { name: "xcsh-linux-x64", size: binary.length, sha256: sha(binary) },
};
const pin = { index: { gzip_sha256: sha(gzip), gzip_size_bytes: gzip.length } };

describe("immutable native corpus recovery", () => {
	it("recovers only the exact pinned gzip past unrelated compressed assets", () => {
		expect(recoverPinnedIndex(binary, provenance, pin, identity)).toEqual(gzip);
	});
	it("rejects a binary that differs from its release provenance", () => {
		expect(() =>
			recoverPinnedIndex(Buffer.concat([binary, Buffer.from("changed")]), provenance, pin, identity),
		).toThrow(/provenance/);
	});
	it("rejects a different tag source or original build run", () => {
		expect(() => recoverPinnedIndex(binary, provenance, pin, { ...identity, commit: "b".repeat(40) })).toThrow(
			/identity/,
		);
		expect(() => recoverPinnedIndex(binary, provenance, pin, { ...identity, runId: "124" })).toThrow(/identity/);
	});
	it("fails when pinned bytes are absent rather than regenerating sources", () => {
		expect(() =>
			recoverPinnedIndex(binary, provenance, { index: { ...pin.index, gzip_sha256: "c".repeat(64) } }, identity),
		).toThrow(/absent/);
	});
	it("rejects malformed or oversized pin lengths", () => {
		for (const size of [0, -1, 1.5, Number.MAX_SAFE_INTEGER]) {
			expect(() =>
				recoverPinnedIndex(binary, provenance, { index: { ...pin.index, gzip_size_bytes: size } }, identity),
			).toThrow(/pin/);
		}
	});
});
