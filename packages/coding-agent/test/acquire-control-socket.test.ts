/**
 * Unit tests for `acquireControlSocket` — the manager's runtime-robust
 * control-socket bind. Covers the single-manager invariant AND stale-socket
 * reclamation without depending on Bun's runtime-specific unix-socket behavior
 * (dev `bun run` silently rebinds a stale socket; the compiled binary throws
 * EADDRINUSE — see xcsh #1846). Effects are injected so every branch is
 * deterministic.
 */
import { expect, test } from "bun:test";
import { acquireControlSocket } from "../src/commands/manager";

const addrInUse = () => Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" });
const isAddrInUse = (e: unknown): boolean => (e as { code?: string } | null)?.code === "EADDRINUSE";

test("a live manager already owns the socket → already-live, never listens or unlinks", async () => {
	const calls: string[] = [];
	const outcome = await acquireControlSocket({
		sockPath: "/tmp/x.sock",
		probeLive: async () => true,
		listen: () => calls.push("listen"),
		unlink: () => calls.push("unlink"),
		isAddrInUse,
	});
	expect(outcome).toBe("already-live");
	expect(calls).toEqual([]); // must not touch the live manager's socket
});

test("free path → binds on the first listen, no unlink", async () => {
	const calls: string[] = [];
	const outcome = await acquireControlSocket({
		sockPath: "/tmp/x.sock",
		probeLive: async () => false,
		listen: () => calls.push("listen"),
		unlink: () => calls.push("unlink"),
		isAddrInUse,
	});
	expect(outcome).toBe("bound");
	expect(calls).toEqual(["listen"]);
});

test("stale socket file (no live owner) → EADDRINUSE, then unlink + retry listen → bound", async () => {
	const calls: string[] = [];
	let listens = 0;
	const outcome = await acquireControlSocket({
		sockPath: "/tmp/x.sock",
		probeLive: async () => false, // dead on both probes
		listen: () => {
			calls.push("listen");
			if (++listens === 1) throw addrInUse(); // compiled-runtime behavior on a stale socket
		},
		unlink: () => calls.push("unlink"),
		isAddrInUse,
	});
	expect(outcome).toBe("bound");
	expect(calls).toEqual(["listen", "unlink", "listen"]); // reclaimed the stale path, then bound
});

test("EADDRINUSE but a live manager appears on the re-probe (cold-start race) → already-live, no unlink", async () => {
	const calls: string[] = [];
	const probes = [false, true]; // free when we first probed; a rival bound before our listen
	const outcome = await acquireControlSocket({
		sockPath: "/tmp/x.sock",
		probeLive: async () => probes.shift() ?? true,
		listen: () => {
			calls.push("listen");
			throw addrInUse();
		},
		unlink: () => calls.push("unlink"),
		isAddrInUse,
	});
	expect(outcome).toBe("already-live");
	expect(calls).toEqual(["listen"]); // must NOT unlink a rival live manager's socket
});

test("a non-EADDRINUSE listen error propagates (real failure, never swallowed)", async () => {
	await expect(
		acquireControlSocket({
			sockPath: "/tmp/x.sock",
			probeLive: async () => false,
			listen: () => {
				throw Object.assign(new Error("EACCES"), { code: "EACCES" });
			},
			unlink: () => {},
			isAddrInUse,
		}),
	).rejects.toThrow("EACCES");
});

test("if the retry listen still fails, the error propagates (loud, not a phantom bind)", async () => {
	await expect(
		acquireControlSocket({
			sockPath: "/tmp/x.sock",
			probeLive: async () => false,
			listen: () => {
				throw addrInUse();
			}, // throws every time
			unlink: () => {},
			isAddrInUse,
		}),
	).rejects.toThrow("EADDRINUSE");
});
