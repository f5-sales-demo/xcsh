import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteRouter } from "../../src/remote-control/router";

test("phone file search owns sessions and delivers matching and empty query completion", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-search-"));
	const router = new RemoteRouter(join(root, "agent"), "fixture");
	router.registerSession("primary", {
		thread: { id: "primary", cwd: root, turns: [], updatedAt: 1 },
		call: async () => ({}),
	});
	const events: any[] = [];
	router.notify = (client, event) => events.push({ client, ...event });
	const rpc = (client: string, method: string, params: object) => router.handle(client, { id: 1, method, params });
	try {
		await writeFile(join(root, "last-turn.txt"), "fixture");
		for (const client of ["phone", "other"])
			await rpc(client, "initialize", {
				clientInfo: { name: "fixture", version: "1" },
				capabilities: { experimentalApi: true },
			});
		expect(await rpc("phone", "fuzzyFileSearch/sessionStart", { sessionId: "search", roots: [root] })).toEqual({
			id: 1,
			result: {},
		});
		expect(
			await rpc("other", "fuzzyFileSearch/sessionUpdate", { sessionId: "search", query: "last" }),
		).toHaveProperty("error");
		expect(await rpc("phone", "fuzzyFileSearch/sessionUpdate", { sessionId: "search", query: "last" })).toEqual({
			id: 1,
			result: {},
		});
		await Bun.sleep(20);
		const match = events.findLast(event => event.method === "fuzzyFileSearch/sessionUpdated");
		expect(match.client).toBe("phone");
		expect(match.params.files).toMatchObject([
			{ path: "last-turn.txt", file_name: "last-turn.txt", match_type: "file", root },
		]);
		await rpc("phone", "fuzzyFileSearch/sessionUpdate", { sessionId: "search", query: "no-match-fixture" });
		await Bun.sleep(20);
		expect(events.findLast(event => event.method === "fuzzyFileSearch/sessionUpdated").params.files).toEqual([]);
		expect(events.at(-1).method).toBe("fuzzyFileSearch/sessionCompleted");
		events.length = 0;
		await rpc("phone", "fuzzyFileSearch/sessionUpdate", { sessionId: "search", query: "last" });
		await rpc("phone", "fuzzyFileSearch/sessionUpdate", { sessionId: "search", query: "no-match" });
		await Bun.sleep(20);
		expect(
			events
				.filter(event => event.method === "fuzzyFileSearch/sessionUpdated")
				.every(event => event.params.query === "no-match"),
		).toBe(true);
		events.length = 0;
		await rpc("phone", "fuzzyFileSearch/sessionUpdate", { sessionId: "search", query: "last" });
		expect(await rpc("phone", "fuzzyFileSearch/sessionStop", { sessionId: "search" })).toEqual({ id: 1, result: {} });
		await Bun.sleep(20);
		expect(events).toEqual([]);
		expect(
			await rpc("phone", "fuzzyFileSearch/sessionUpdate", { sessionId: "search", query: "last" }),
		).toHaveProperty("error");
		expect(
			await rpc("phone", "fuzzyFileSearch/sessionStart", { sessionId: "outside", roots: ["/etc"] }),
		).toHaveProperty("error");
	} finally {
		router.dispose();
		await rm(root, { recursive: true, force: true });
	}
});
