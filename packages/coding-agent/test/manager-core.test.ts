import { describe, expect, it, test } from "bun:test";
import { sparesToSpawn } from "@f5-sales-demo/xcsh/commands/manager-core";
import {
	binaryIsStale,
	keepaliveFrame,
	type ManagerState,
	needsProvision,
	parseControlMsg,
	parseManagerState,
	type Registry,
	selectSpawnPort,
	serializeManagerState,
	shouldSupersede,
	staleKeys,
	touchLastSeen,
	type WorkerRec,
} from "../src/commands/manager-core";

function reg(...recs: WorkerRec[]): Registry {
	const m: Registry = new Map();
	for (const r of recs) m.set(r.sessionId, r);
	return m;
}
const W = (sessionId: string, port: number, lastSeen = 0): WorkerRec => ({
	sessionId,
	tenant: "acme|production",
	port,
	pid: 1,
	lastSeen,
});

describe("parseControlMsg", () => {
	test("valid provision/release/status", () => {
		expect(parseControlMsg({ type: "provision", sessionId: "tab-7", tenant: "acme|staging" })).toEqual({
			type: "provision",
			sessionId: "tab-7",
			tenant: "acme|staging",
		});
		expect(parseControlMsg({ type: "release", sessionId: "tab-7" })).toEqual({ type: "release", sessionId: "tab-7" });
		expect(parseControlMsg({ type: "status" })).toEqual({ type: "status" });
	});
	// Keepalive-on-chat: a status frame MAY carry the chatting worker's sessionId
	// so the manager can refresh its lastSeen (chat traffic never reaches the
	// manager otherwise). An sid-less status stays the legacy no-op sink.
	test("status carries an optional sessionId", () => {
		expect(parseControlMsg({ type: "status", sessionId: "tab-7" })).toEqual({ type: "status", sessionId: "tab-7" });
		expect(parseControlMsg({ type: "status", sessionId: "" })).toEqual({ type: "status" }); // empty → sink
		expect(parseControlMsg({ type: "status", sessionId: 3 })).toEqual({ type: "status" }); // non-string → sink
	});
	test("rejects junk / missing fields / bad tenant", () => {
		expect(parseControlMsg({ type: "provision", sessionId: "tab-7" })).toBeNull(); // no tenant
		expect(parseControlMsg({ type: "provision", tenant: "acme|staging" })).toBeNull(); // no sessionId
		expect(parseControlMsg({ type: "provision", sessionId: "tab-7", tenant: "no-pipe" })).toBeNull();
		expect(parseControlMsg({ type: "release" })).toBeNull();
		expect(parseControlMsg({ type: "nope", sessionId: "tab-7" })).toBeNull();
		expect(parseControlMsg(null)).toBeNull();
	});
	// #1874 lifecycle frames.
	test("accepts hello and shutdown{reason}", () => {
		expect(parseControlMsg({ type: "hello" })).toEqual({ type: "hello" });
		expect(parseControlMsg({ type: "shutdown", reason: "superseded" })).toEqual({
			type: "shutdown",
			reason: "superseded",
		});
		expect(parseControlMsg({ type: "shutdown", reason: "updated" })).toEqual({ type: "shutdown", reason: "updated" });
		expect(parseControlMsg({ type: "shutdown", reason: "manual" })).toEqual({ type: "shutdown", reason: "manual" });
	});
	test("rejects shutdown with an unknown/missing reason (fail closed)", () => {
		expect(parseControlMsg({ type: "shutdown" })).toBeNull();
		expect(parseControlMsg({ type: "shutdown", reason: "hax" })).toBeNull();
		expect(parseControlMsg({ type: "shutdown", reason: 3 })).toBeNull();
	});
});

// #1874: version-aware supersede — a NEWER binary replaces an older running
// manager; equal/newer/malformed never supersede (fail closed, no flapping).
describe("shouldSupersede", () => {
	it("true only when ourVersion is strictly greater", () => {
		expect(shouldSupersede("19.56.2", "19.58.1")).toBe(true);
		expect(shouldSupersede("19.58.0", "19.58.1")).toBe(true);
		expect(shouldSupersede("18.99.99", "19.0.0")).toBe(true);
	});
	it("false on equal or newer running version", () => {
		expect(shouldSupersede("19.58.1", "19.58.1")).toBe(false);
		expect(shouldSupersede("19.58.2", "19.58.1")).toBe(false);
		expect(shouldSupersede("20.0.0", "19.58.1")).toBe(false);
	});
	it("false (fail closed) on null / malformed versions", () => {
		expect(shouldSupersede(null, "19.58.1")).toBe(false);
		expect(shouldSupersede("", "19.58.1")).toBe(false);
		expect(shouldSupersede("garbage", "19.58.1")).toBe(false);
		expect(shouldSupersede("19.58", "19.58.1")).toBe(false);
		expect(shouldSupersede("19.56.2", "notsemver")).toBe(false);
	});
});

describe("manager state file round-trip", () => {
	const s: ManagerState = {
		pid: 4242,
		version: "19.58.1",
		socket: "/home/u/.xcsh/manager.sock",
		startedAt: 1_700_000,
	};
	it("serialize → parse is identity", () => {
		expect(parseManagerState(serializeManagerState(s))).toEqual(s);
	});
	it("returns null on corrupt / missing / bad-shape input", () => {
		expect(parseManagerState("{not json")).toBeNull();
		expect(parseManagerState("{}")).toBeNull();
		expect(parseManagerState(JSON.stringify({ pid: -1, version: "1.0.0", socket: "/s", startedAt: 1 }))).toBeNull();
		expect(parseManagerState(JSON.stringify({ pid: 5, version: "", socket: "/s", startedAt: 1 }))).toBeNull();
		expect(parseManagerState(JSON.stringify({ pid: 5, version: "1.0.0", startedAt: 1 }))).toBeNull();
	});
});
describe("needsProvision (idempotent per sessionId)", () => {
	test("true when no live worker, false when one exists", () => {
		expect(needsProvision(reg(), "tab-7")).toBe(true);
		expect(needsProvision(reg(W("tab-7", 19222)), "tab-7")).toBe(false);
	});
	test("two same-tenant sids are independent", () => {
		const r = reg(W("tab-7", 19222));
		expect(needsProvision(r, "tab-8")).toBe(true); // same tenant, different tab → still needs its own worker
	});
});
describe("staleKeys", () => {
	test("returns sids idle beyond ttl", () => {
		const now = 100_000;
		expect(staleKeys(reg(W("a", 19222, now - 40_000), W("b", 19223, now - 5_000)), now, 30_000)).toEqual(["a"]);
	});
});

// Keepalive-on-chat (#idle-reap): the worker sends a `status{sessionId}` frame
// while actively chatting; the manager refreshes lastSeen so its idle sweep does
// not reap a session that is in use. Chat frames never reach the manager, so
// without this an actively-used-then-briefly-idle worker gets swept mid-use.
describe("touchLastSeen", () => {
	test("refreshes a known session so staleKeys no longer reaps it", () => {
		const now = 1_000_000;
		const r = reg(W("tab-7", 19222, now - 40_000));
		expect(staleKeys(r, now, 30_000)).toEqual(["tab-7"]); // stale before the keepalive
		expect(touchLastSeen(r, "tab-7", now)).toBe(true);
		expect(staleKeys(r, now, 30_000)).toEqual([]); // kept alive by the keepalive
	});
	test("ignores an unknown or absent sessionId (no throw, returns false)", () => {
		const r = reg(W("tab-7", 19222, 5));
		expect(touchLastSeen(r, "ghost", 999)).toBe(false);
		expect(touchLastSeen(r, undefined, 999)).toBe(false);
		expect(r.get("tab-7")?.lastSeen).toBe(5); // untouched
	});
});

// Durable-upgrade self-recycle (#upgrade-recycle): a COMPILED manager whose on-disk
// binary was removed (brew cleanup after `brew upgrade`) can no longer spawn workers
// (spawn ENOENT), so it must step down and let a fresh manager take over. Dev
// (`bun src/cli.ts`, compiled=false) is never stale; fail-closed on any fs error so
// uncertainty never triggers a recycle loop.
describe("binaryIsStale", () => {
	const exists = (present: boolean) => () => present;
	test("compiled + binary missing → stale (the brew-cleanup case)", () => {
		expect(
			binaryIsStale({ compiled: true, execPath: "/opt/homebrew/Cellar/xcsh/old/bin/xcsh", exists: exists(false) }),
		).toBe(true);
	});
	test("compiled + binary present → not stale", () => {
		expect(
			binaryIsStale({ compiled: true, execPath: "/opt/homebrew/Cellar/xcsh/cur/bin/xcsh", exists: exists(true) }),
		).toBe(false);
	});
	test("dev (not compiled) is never stale, even if the path is missing", () => {
		expect(binaryIsStale({ compiled: false, execPath: "/usr/local/bin/bun", exists: exists(false) })).toBe(false);
	});
	test("fail-closed: a throwing exists() is treated as NOT stale (never recycle on uncertainty)", () => {
		const throws = () => {
			throw new Error("fs blew up");
		};
		expect(binaryIsStale({ compiled: true, execPath: "/x", exists: throws })).toBe(false);
	});
});

describe("keepaliveFrame", () => {
	test("builds an NDJSON status frame carrying the sessionId", () => {
		expect(keepaliveFrame("tab-7")).toBe('{"type":"status","sessionId":"tab-7"}\n');
	});
	test("returns null for the unbound spare sentinel or an empty id (nothing to keep alive)", () => {
		expect(keepaliveFrame("spare")).toBeNull();
		expect(keepaliveFrame("")).toBeNull();
	});
});

describe("sparesToSpawn", () => {
	it("spawns up to target when ports are plentiful", () => {
		expect(sparesToSpawn(2, 0, 0, 20)).toBe(2);
		expect(sparesToSpawn(2, 1, 0, 20)).toBe(1);
		expect(sparesToSpawn(2, 2, 0, 20)).toBe(0);
	});
	it("never exceeds the port budget (spares + active <= totalPorts)", () => {
		expect(sparesToSpawn(2, 0, 19, 20)).toBe(1); // only 1 free slot
		expect(sparesToSpawn(2, 0, 20, 20)).toBe(0); // range full
		expect(sparesToSpawn(2, 1, 19, 20)).toBe(0); // 1 spare + 19 active = full
	});
	it("is never negative and treats target 0 as disabled", () => {
		expect(sparesToSpawn(0, 0, 0, 20)).toBe(0);
		expect(sparesToSpawn(2, 5, 0, 20)).toBe(0);
	});
});

describe("selectSpawnPort never probes a port it already handed out (#2463)", () => {
	/**
	 * `isPortFree` is not a read — it BINDS the port and closes it again. Probing a
	 * port that a just-spawned worker is still starting up to bind can therefore win
	 * that bind, and a worker whose forced XCSH_BRIDGE_PORT is occupied throws and
	 * exits (extension-bridge.ts: "XCSH_BRIDGE_PORT N is already in use"). Its
	 * registry entry is then dropped by proc.exited, leaving the session with no
	 * worker at all.
	 *
	 * That is the two-tab failure: provision tab-101, then 50ms later provision
	 * tab-102, whose port probe sweeps the whole range including tab-101's port and
	 * kills tab-101's worker mid-bind. Exactly one port ends up advertising the
	 * tenant — the `Received: 1` seen twice on CI, at 20972ms and 21036ms.
	 *
	 * spawnSpare already filtered assigned ports out before probing; spawnWorker did
	 * not. The rule belongs in one place, so neither can drift again.
	 */
	function regWith(entries: Array<[string, number]>): Registry {
		const reg: Registry = new Map();
		for (const [sessionId, port] of entries) {
			reg.set(sessionId, { sessionId, tenant: "acme|staging", port, pid: 1000 + port, lastSeen: 0 });
		}
		return reg;
	}

	it("does not probe a port assigned to a live registry entry", () => {
		const probed: number[] = [];
		const reg = regWith([["tab-101", 19222]]);
		const port = selectSpawnPort(reg, [19222, 19223, 19224], [], p => {
			probed.push(p);
			return true;
		});
		// The assigned port must never be bound by the probe, even transiently.
		expect(probed).not.toContain(19222);
		expect(port).toBe(19223);
	});

	it("does not probe a port reserved by a pending spare", () => {
		const probed: number[] = [];
		const port = selectSpawnPort(new Map(), [19222, 19223], [19222], p => {
			probed.push(p);
			return true;
		});
		expect(probed).not.toContain(19222);
		expect(port).toBe(19223);
	});

	it("still probes unassigned ports, since another app or a stale worker may hold them", () => {
		const probed: number[] = [];
		const reg = regWith([["tab-101", 19222]]);
		const port = selectSpawnPort(reg, [19222, 19223, 19224], [], p => {
			probed.push(p);
			return p !== 19223; // 19223 occupied by something outside our registry
		});
		expect(probed).toEqual([19223, 19224]);
		expect(port).toBe(19224);
	});

	it("returns null when every candidate is assigned or occupied", () => {
		const reg = regWith([["tab-101", 19222]]);
		expect(selectSpawnPort(reg, [19222, 19223], [], () => false)).toBeNull();
	});

	it("stops probing once it has a port, so it binds no more ports than necessary", () => {
		const probed: number[] = [];
		const port = selectSpawnPort(new Map(), [19222, 19223, 19224], [], p => {
			probed.push(p);
			return true;
		});
		expect(port).toBe(19222);
		expect(probed).toEqual([19222]); // lazy: 19223/19224 never bound
	});
});
