import { describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ttftAttr } from "../src/logger";

describe("ttftAttr", () => {
	it("is a pure pass-through with no output when the flag is unset", () => {
		delete process.env.XCSH_TTFT_ATTRIBUTION;
		delete process.env.XCSH_TTFT_ATTR_FILE;
		const err = spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(ttftAttr("ttft.x", (a: number, b: number) => a + b, 2, 3)).toBe(5);
			expect(err).not.toHaveBeenCalled();
		} finally {
			err.mockRestore();
		}
	});

	it("emits one [ttft-attr] line for a sync fn when enabled and returns the value", () => {
		process.env.XCSH_TTFT_ATTRIBUTION = "1";
		delete process.env.XCSH_TTFT_ATTR_FILE;
		const err = spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(ttftAttr("ttft.sync", () => 42)).toBe(42);
			const lines = err.mock.calls.map(c => String(c[0]));
			const hit = lines.filter(l => l.startsWith("[ttft-attr] ttft.sync "));
			expect(hit.length).toBe(1);
			expect(Number(hit[0].split(" ")[2])).toBeGreaterThanOrEqual(0);
		} finally {
			err.mockRestore();
			delete process.env.XCSH_TTFT_ATTRIBUTION;
		}
	});

	it("is await-accurate for a Promise fn (emits after it resolves)", async () => {
		process.env.XCSH_TTFT_ATTRIBUTION = "1";
		delete process.env.XCSH_TTFT_ATTR_FILE;
		const err = spyOn(console, "error").mockImplementation(() => {});
		try {
			const v = await ttftAttr("ttft.async", async () => {
				await Bun.sleep(15);
				return "ok";
			});
			expect(v).toBe("ok");
			const hit = err.mock.calls.map(c => String(c[0])).filter(l => l.startsWith("[ttft-attr] ttft.async "));
			expect(hit.length).toBe(1);
			expect(Number(hit[0].split(" ")[2])).toBeGreaterThanOrEqual(10);
		} finally {
			err.mockRestore();
			delete process.env.XCSH_TTFT_ATTRIBUTION;
		}
	});

	it("emits then rethrows when the fn throws", () => {
		process.env.XCSH_TTFT_ATTRIBUTION = "1";
		delete process.env.XCSH_TTFT_ATTR_FILE;
		const err = spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(() =>
				ttftAttr("ttft.boom", () => {
					throw new Error("nope");
				}),
			).toThrow("nope");
			const hit = err.mock.calls.map(c => String(c[0])).filter(l => l.startsWith("[ttft-attr] ttft.boom "));
			expect(hit.length).toBe(1);
		} finally {
			err.mockRestore();
			delete process.env.XCSH_TTFT_ATTRIBUTION;
		}
	});

	it("appends the [ttft-attr] line to XCSH_TTFT_ATTR_FILE when set (file transport)", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ttft-attr-"));
		const file = path.join(dir, "attr.log");
		process.env.XCSH_TTFT_ATTRIBUTION = "1";
		process.env.XCSH_TTFT_ATTR_FILE = file;
		try {
			expect(ttftAttr("ttft.f", () => 1)).toBe(1);
			const contents = fs.readFileSync(file, "utf8");
			expect(contents).toMatch(/^\[ttft-attr\] ttft\.f \d/m);
		} finally {
			delete process.env.XCSH_TTFT_ATTRIBUTION;
			delete process.env.XCSH_TTFT_ATTR_FILE;
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("never throws when the file transport path is unwritable", () => {
		process.env.XCSH_TTFT_ATTRIBUTION = "1";
		process.env.XCSH_TTFT_ATTR_FILE = "/nonexistent-dir-xyz/attr.log";
		try {
			expect(ttftAttr("ttft.e", () => 7)).toBe(7);
		} finally {
			delete process.env.XCSH_TTFT_ATTRIBUTION;
			delete process.env.XCSH_TTFT_ATTR_FILE;
		}
	});
});
