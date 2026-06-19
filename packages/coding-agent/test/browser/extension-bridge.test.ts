import { describe, expect, it } from "bun:test";
import { PendingRequests } from "@f5xc-salesdemos/xcsh/browser/extension-bridge";

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
		expect(p.create(1000).id).not.toBe(p.create(1000).id);
	});
	it("rejectAll fails outstanding promises", async () => {
		const p = new PendingRequests();
		const { promise } = p.create(1000);
		p.rejectAll(new Error("disconnected"));
		await expect(promise).rejects.toThrow(/disconnected/);
	});
});
