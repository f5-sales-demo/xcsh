import { describe, expect, it } from "bun:test";
import { OutputTooLargeError, ptree } from "../src/index";

// Regression for issue #1552: subprocess stdout was collected via
// `new Response(stream).text()` with no cap, so a command emitting huge output
// grew the heap until `RangeError: Out of memory` crashed the whole process.
// ptree now bounds collection and throws OutputTooLargeError instead.
describe("ptree.exec output cap", () => {
	it("throws OutputTooLargeError when stdout exceeds the cap", async () => {
		await expect(
			ptree.exec(["bun", "-e", "process.stdout.write('x'.repeat(200000))"], {
				maxOutputBytes: 1024,
				allowNonZero: true,
			}),
		).rejects.toBeInstanceOf(OutputTooLargeError);
	});

	it("returns full stdout when under the cap", async () => {
		const result = await ptree.exec(["bun", "-e", "process.stdout.write('hello world')"], {
			maxOutputBytes: 1024,
		});
		expect(result.stdout).toBe("hello world");
	});

	it("caps an unbounded (infinite) producer without OOM", async () => {
		// A producer that never stops — the cap must cancel the reader and throw
		// rather than buffer forever.
		await expect(
			ptree.exec(["bun", "-e", "while(true){process.stdout.write('y'.repeat(4096))}"], {
				maxOutputBytes: 64 * 1024,
				allowNonZero: true,
				allowAbort: true,
			}),
		).rejects.toBeInstanceOf(OutputTooLargeError);
	});
});
