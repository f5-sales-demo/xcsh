import { describe, expect, it, test } from "bun:test";
import {
	PendingRequests,
	PORT_RANGE_END,
	PORT_RANGE_START,
	portCandidates,
	resolveForcedPort,
} from "@f5-sales-demo/xcsh/browser/extension-bridge";

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

describe("port selection helpers", () => {
	test("portCandidates is the full inclusive range", () => {
		const c = portCandidates();
		expect(c[0]).toBe(PORT_RANGE_START);
		expect(c.at(-1)).toBe(PORT_RANGE_END);
		expect(c.length).toBe(PORT_RANGE_END - PORT_RANGE_START + 1);
	});

	test("resolveForcedPort: explicit arg wins", () => {
		expect(resolveForcedPort(20000)).toBe(20000);
	});

	test("resolveForcedPort: env when no arg", () => {
		const prev = process.env.XCSH_BRIDGE_PORT;
		process.env.XCSH_BRIDGE_PORT = "19230";
		try {
			expect(resolveForcedPort()).toBe(19230);
		} finally {
			if (prev === undefined) delete process.env.XCSH_BRIDGE_PORT;
			else process.env.XCSH_BRIDGE_PORT = prev;
		}
	});

	test("resolveForcedPort: null when neither set", () => {
		const prev = process.env.XCSH_BRIDGE_PORT;
		delete process.env.XCSH_BRIDGE_PORT;
		try {
			expect(resolveForcedPort()).toBeNull();
		} finally {
			if (prev !== undefined) process.env.XCSH_BRIDGE_PORT = prev;
		}
	});
});

import { startBridgeServer } from "../../src/browser/extension-bridge";

describe("auto-select bind", () => {
	test("two servers land on different ports in range", async () => {
		const a = await startBridgeServer(undefined, { skipOriginCheck: true });
		const b = await startBridgeServer(undefined, { skipOriginCheck: true });
		try {
			expect(a.port).toBeGreaterThanOrEqual(PORT_RANGE_START);
			expect(b.port).toBeGreaterThanOrEqual(PORT_RANGE_START);
			expect(a.port).not.toBe(b.port);
		} finally {
			await a.close();
			await b.close();
		}
	});

	test("forced port that is taken fails loud", async () => {
		const a = await startBridgeServer(undefined, { skipOriginCheck: true });
		try {
			await expect(startBridgeServer(a.port, { skipOriginCheck: true })).rejects.toThrow();
		} finally {
			await a.close();
		}
	});
});
