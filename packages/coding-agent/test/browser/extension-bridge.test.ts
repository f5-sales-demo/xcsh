import { describe, expect, it } from "bun:test";
import { PendingRequests } from "@f5-sales-demo/xcsh/browser/extension-bridge";

describe("PendingRequests", () => {
	it("resolves the matching id and ignores unknown ids", async () => {
		const p = new PendingRequests();
		const { id, promise } = p.create(1000);
		expect(p.resolve("nope", { content: 1, is_error: false })).toBe(false);
		expect(p.resolve(id, { content: "ok", is_error: false })).toBe(true);
		expect(await promise).toEqual({ content: "ok", is_error: false });
	});
	it("generates unique ids", () => {
		const p = new PendingRequests();
		const a = p.create(1000);
		const b = p.create(1000);
		expect(a.id).not.toBe(b.id);
		// Clean up: reject + swallow so their timers don't fire as unhandled errors after the test.
		p.rejectAll(new Error("cleanup"));
		a.promise.catch(() => {});
		b.promise.catch(() => {});
	});
	it("rejectAll fails outstanding promises", async () => {
		const p = new PendingRequests();
		const { promise } = p.create(1000);
		p.rejectAll(new Error("disconnected"));
		await expect(promise).rejects.toThrow(/disconnected/);
	});
});
