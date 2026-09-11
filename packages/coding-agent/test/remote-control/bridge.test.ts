import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSessionBridge } from "../../src/remote-control/bridge";
import { startLocalHost } from "../../src/remote-control/host";
import type { SessionTarget } from "../../src/remote-control/session";

test("a running session reconnects to the host and unregisters on bridge shutdown", async () => {
	const dir = await mkdtemp(join(tmpdir(), "xcsh-bridge-test-"));
	const path = join(dir, "host.sock");
	const host = await startLocalHost(path, "21.22.0");
	const target = {
		sessionId: "fixture",
		sessionName: "Fixture",
		messages: [],
		skills: [
			{
				name: "fixture",
				description: "Fixture",
				filePath: join(dir, "SKILL.md"),
				baseDir: dir,
				source: "agents:project",
				_source: { provider: "agents", providerName: "Agents", path: join(dir, "SKILL.md"), level: "project" },
			},
		],
		skillWarnings: [],
		sessionManager: { getCwd: () => dir },
		subscribe: () => () => {},
	} as unknown as SessionTarget;
	const stop = startSessionBridge(target, path, 20);
	try {
		const deadline = Date.now() + 1000;
		while (!host.router.sessions.has("fixture") && Date.now() < deadline) await Bun.sleep(10);
		expect(host.router.sessions.has("fixture")).toBe(true);
		expect(host.router.sessions.get("fixture")?.skills).toMatchObject([
			{ name: "fixture", path: join(dir, "SKILL.md"), scope: "repo", enabled: true },
		]);
		stop();
		await Bun.sleep(20);
		expect(host.router.sessions.has("fixture")).toBe(false);
	} finally {
		stop();
		await host.close();
		await rm(dir, { recursive: true, force: true });
	}
});
