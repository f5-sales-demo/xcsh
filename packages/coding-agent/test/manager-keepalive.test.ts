import { describe, expect, it } from "bun:test";
import { type KeepaliveTransport, ManagerKeepalive } from "../src/commands/manager-keepalive";

/** A transport that records every frame written and whether it was closed. */
function fakeTransport() {
	const writes: string[] = [];
	let closed = false;
	const t: KeepaliveTransport = {
		write: (d: string) => {
			writes.push(d);
		},
		close: () => {
			closed = true;
		},
	};
	return { t, writes, isClosed: () => closed };
}

/** A connector that hands out the given transports in order and lets a test fire
 * the onClose callback for any prior connection (simulating a dropped socket). */
function fakeConnector(transports: ReturnType<typeof fakeTransport>[]) {
	let calls = 0;
	const closers: Array<() => void> = [];
	const connect = async (onClose: () => void): Promise<KeepaliveTransport | null> => {
		closers.push(onClose);
		const rec = transports[calls] ?? transports[transports.length - 1];
		calls += 1;
		return rec.t;
	};
	return { connect, calls: () => calls, fireClose: (i: number) => closers[i]?.() };
}

/** Let queued microtasks + the async connect promise settle. */
const flush = () => new Promise<void>(r => setTimeout(r, 0));

describe("ManagerKeepalive", () => {
	it("emits a keepalive frame at turn start for a bound session", async () => {
		const tp = fakeTransport();
		const conn = fakeConnector([tp]);
		const ka = new ManagerKeepalive({ connect: conn.connect, sessionId: () => "tab-7", busy: () => false });
		ka.turnStart();
		await flush();
		expect(tp.writes).toEqual(['{"type":"status","sessionId":"tab-7"}\n']);
	});

	it("emits on tick while busy and stays silent while idle", async () => {
		const tp = fakeTransport();
		const conn = fakeConnector([tp]);
		let busy = false;
		const ka = new ManagerKeepalive({ connect: conn.connect, sessionId: () => "tab-7", busy: () => busy });
		ka.tick(); // idle → nothing
		await flush();
		expect(tp.writes).toEqual([]);
		busy = true;
		ka.tick();
		await flush();
		ka.tick();
		await flush();
		expect(tp.writes.length).toBe(2);
	});

	it("never emits (and never connects) for the unbound spare sentinel", async () => {
		const tp = fakeTransport();
		const conn = fakeConnector([tp]);
		const ka = new ManagerKeepalive({ connect: conn.connect, sessionId: () => "spare", busy: () => true });
		ka.turnStart();
		ka.tick();
		await flush();
		expect(tp.writes).toEqual([]);
		expect(conn.calls()).toBe(0);
	});

	it("reconnects and resumes emitting after the socket drops (manager supersede)", async () => {
		const tp1 = fakeTransport();
		const tp2 = fakeTransport();
		const conn = fakeConnector([tp1, tp2]);
		const ka = new ManagerKeepalive({ connect: conn.connect, sessionId: () => "tab-7", busy: () => true });
		ka.turnStart();
		await flush();
		expect(tp1.writes.length).toBe(1);
		conn.fireClose(0); // successor manager superseded us → our socket closed
		ka.tick();
		await flush();
		expect(conn.calls()).toBe(2); // re-targeted the successor manager
		expect(tp2.writes.length).toBe(1); // keepalive resumed on the new connection
	});

	it("stop() closes the transport and halts further emits", async () => {
		const tp = fakeTransport();
		const conn = fakeConnector([tp]);
		const ka = new ManagerKeepalive({ connect: conn.connect, sessionId: () => "tab-7", busy: () => true });
		ka.turnStart();
		await flush();
		ka.stop();
		expect(tp.isClosed()).toBe(true);
		ka.tick();
		await flush();
		expect(tp.writes.length).toBe(1); // no writes after stop
	});
});
