/**
 * Integration test: `xcsh worker` headless mode.
 *
 * Spawns a REAL worker subprocess (`bun src/cli.ts worker`), waits for its
 * extension bridge to bind the forced `XCSH_BRIDGE_PORT`, then performs the
 * `hello` / `hello_ack` handshake over a real WebSocket. The worker starts the
 * bridge WITH origin checking (mirroring main.ts), so the probe presents the
 * extension's `Origin` header — imported from the same source as the worker's
 * check so the two never drift.
 *
 * The load-bearing assertion is that a CONTEXTLESS worker still advertises its
 * tenant in `hello_ack`, derived from `XCSH_SESSION_TENANT` (`tenant|env`).
 */
import { afterEach, expect, test } from "bun:test";
import { EXTENSION_ID } from "@f5-sales-demo/xcsh/cli/chrome-cli";

let proc: import("bun").Subprocess | undefined;
afterEach(() => {
	proc?.kill();
	proc = undefined;
});

test("xcsh worker binds the forced port and advertises its tenant via hello_ack", async () => {
	const port = 19239;
	proc = Bun.spawn(["bun", "src/cli.ts", "worker"], {
		cwd: process.cwd(),
		env: {
			...process.env,
			XCSH_BROWSER_PROVIDER: "extension",
			XCSH_BRIDGE_PORT: String(port),
			XCSH_SESSION_TENANT: "probe-tenant|staging",
			XCSH_API_URL: "",
		},
		stdout: "ignore",
		stderr: "ignore",
	});

	const origin = `chrome-extension://${EXTENSION_ID}`;
	const ack = await (async () => {
		for (let i = 0; i < 60; i++) {
			try {
				const r = await new Promise<Record<string, unknown>>((res, rej) => {
					const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
						headers: { Origin: origin },
					} as unknown as string[]);
					ws.onopen = () =>
						ws.send(JSON.stringify({ type: "hello", contractVersion: "1.5.0", extensionId: "probe" }));
					ws.onmessage = e => {
						res(JSON.parse(e.data as string));
						ws.close();
					};
					ws.onerror = () => rej(new Error("ws"));
					setTimeout(() => rej(new Error("t")), 500);
				});
				return r;
			} catch {
				await Bun.sleep(250);
			}
		}
		throw new Error("worker never came up");
	})();

	expect(ack.type).toBe("hello_ack");
	// Contextless worker: tenant echoed from XCSH_SESSION_TENANT-derived session info.
	expect(ack.tenant).toBe("probe-tenant");
}, 30_000);
