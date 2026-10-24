import { expect, test } from "bun:test";
import { canonicalizeSqliteHeader } from "../../src/internal-urls/sqlite-canonical";

test("platform header differences normalize without changing database payload", () => {
	const first = Buffer.alloc(128, 7);
	first.write("SQLite format 3\0", "ascii");
	first.writeUInt32BE(4, 24);
	first.writeUInt32BE(4, 92);
	first.writeUInt32BE(3_050_000, 96);
	const second = Buffer.from(first);
	second.writeUInt32BE(8, 24);
	second.writeUInt32BE(8, 92);
	second.writeUInt32BE(3_051_000, 96);
	const normalized = canonicalizeSqliteHeader(first);
	expect(normalized).toEqual(canonicalizeSqliteHeader(second));
	expect(normalized.subarray(100)).toEqual(first.subarray(100));
	expect(first.readUInt32BE(24)).toBe(4);
	second[110] = second[110]! ^ 1;
	expect(normalized).not.toEqual(canonicalizeSqliteHeader(second));
});

test("rejects truncated or invalid SQLite headers", () => {
	expect(() => canonicalizeSqliteHeader(Buffer.alloc(99))).toThrow("valid SQLite");
	expect(() => canonicalizeSqliteHeader(Buffer.alloc(128))).toThrow("valid SQLite");
});
