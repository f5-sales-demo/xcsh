import { describe, expect, it, spyOn } from "bun:test";
import { ttftAttr } from "../src/logger";

describe("ttftAttr", () => {
	it("is a pure pass-through with no output when the flag is unset", () => {
		delete process.env.XCSH_TTFT_ATTRIBUTION;
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
});
