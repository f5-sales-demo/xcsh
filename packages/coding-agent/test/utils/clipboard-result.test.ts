import { afterEach, describe, expect, it, vi } from "bun:test";
import * as native from "@f5-sales-demo/pi-natives";
import { copyToClipboardWithDelivery, copyToClipboardWithResult } from "../../src/utils/clipboard";

afterEach(() => vi.restoreAllMocks());

describe("copyToClipboardWithResult", () => {
	it("reports native clipboard success", async () => {
		vi.spyOn(native, "copyToClipboard").mockImplementation(() => undefined);
		expect(await copyToClipboardWithResult("copy me")).toEqual({ ok: true });
	});

	it("reports an actionable failure when no clipboard transport succeeds", async () => {
		vi.spyOn(native, "copyToClipboard").mockImplementation(() => {
			throw new Error("clipboard unavailable");
		});
		expect(await copyToClipboardWithResult("copy me")).toEqual({
			ok: false,
			error: "clipboard unavailable",
		});
	});
});

describe("clipboard delivery evidence", () => {
	it("waits for native completion before confirming a copy", async () => {
		const pending = Promise.withResolvers<void>();
		vi.spyOn(native, "copyToClipboard").mockImplementation(() => pending.promise);
		let settled = false;
		const result = copyToClipboardWithDelivery("synthetic clipboard text").then(value => {
			settled = true;
			return value;
		});
		await Bun.sleep(0);
		expect(settled).toBe(false);
		pending.resolve();
		expect(await result).toEqual({ ok: true, delivery: "copied" });
	});

	it.each([false, true])("terminal writes are requests, and failed writes do not count (failed: %s)", async failed => {
		const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
		Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
		const pending = Promise.withResolvers<void>();
		const writes: string[] = [];
		vi.spyOn(native, "copyToClipboard").mockImplementation(() => {
			throw new Error("native clipboard unavailable");
		});
		const writer = vi.spyOn(process.stdout, "write").mockImplementation(((
			text: string,
			callback: (error?: Error) => void,
		) => {
			writes.push(text);
			void pending.promise.then(() => callback(failed ? new Error("terminal write failed") : undefined));
			return true;
		}) as typeof process.stdout.write);
		try {
			let settled = false;
			const result = copyToClipboardWithDelivery("synthetic").then(value => {
				settled = true;
				return value;
			});
			await Bun.sleep(0);
			expect(settled).toBe(false);
			pending.resolve();
			expect(await result).toEqual(
				failed ? { ok: false, error: "native clipboard unavailable" } : { ok: true, delivery: "requested" },
			);
			expect(writes).toEqual(["\x1b]52;c;c3ludGhldGlj\x07"]);
		} finally {
			pending.resolve();
			writer.mockRestore();
			if (descriptor) Object.defineProperty(process.stdout, "isTTY", descriptor);
			else Reflect.deleteProperty(process.stdout, "isTTY");
		}
	});

	it("a failed terminal write cannot turn a successful native fallback into an error", async () => {
		const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
		Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
		const writer = vi.spyOn(process.stdout, "write").mockImplementation(((
			_text: string,
			callback: (error?: Error) => void,
		) => {
			callback(new Error("Synthetic broken pipe"));
			return false;
		}) as typeof process.stdout.write);
		vi.spyOn(native, "copyToClipboard").mockImplementation(() => {
			// Streams can emit their error after invoking the write callback.
			process.stdout.emit("error", new Error("Synthetic broken pipe"));
		});
		try {
			expect(await copyToClipboardWithDelivery("synthetic")).toEqual({ ok: true, delivery: "copied" });
		} finally {
			writer.mockRestore();
			if (descriptor) Object.defineProperty(process.stdout, "isTTY", descriptor);
			else Reflect.deleteProperty(process.stdout, "isTTY");
		}
	});
});
