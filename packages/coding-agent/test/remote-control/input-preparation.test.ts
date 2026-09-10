import { expect, test } from "bun:test";
import { Agent } from "@f5-sales-demo/pi-agent-core";
import { getBundledModel } from "@f5-sales-demo/pi-ai";
import { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import { AgentSession } from "../../src/session/agent-session";
import { AuthStorage } from "../../src/session/auth-storage";
import { SessionManager } from "../../src/session/session-manager";

test.each(["steer", "followUp"] as const)(
	"%s admission joins preparation and rejects cancelled ownership",
	async method => {
		for (const cancel of ["none", "abort", "dispose"] as const) {
			const auth = await AuthStorage.create(":memory:");
			const model = getBundledModel("openai", "gpt-4o-mini")!;
			const session = new AgentSession({
				agent: new Agent({ initialState: { model } }),
				sessionManager: SessionManager.inMemory(),
				settings: Settings.isolated({ "compaction.enabled": false }),
				modelRegistry: new ModelRegistry(auth),
			});
			const entered = Promise.withResolvers<void>(),
				release = Promise.withResolvers<void>();
			const unsubscribe = session.addBeforeUserInputHook(async message => {
				expect(message.content).toEqual([{ type: "text", text: "Prepared" }]);
				entered.resolve();
				await release.promise;
			});
			const pending = session[method]("Prepared").then(
				() => undefined,
				error => error,
			);
			try {
				await entered.promise;
				expect(session.queuedMessageCount).toBe(0);
				if (cancel === "abort") await session.abort();
				if (cancel === "dispose") await session.dispose();
				release.resolve();
				const result = await pending;
				if (cancel === "none") {
					expect(result).toBeUndefined();
					expect(session.getQueuedMessages()[method === "steer" ? "steering" : "followUp"]).toEqual(["Prepared"]);
				} else {
					expect(result).toBeInstanceOf(Error);
					expect(session.queuedMessageCount).toBe(0);
				}
			} finally {
				release.resolve();
				await pending;
				unsubscribe();
				await session.dispose();
				auth.close();
			}
		}
	},
);

test("delegated input keeps the speech segment open while typed steering seals it", async () => {
	const { getSessionVoiceHistory } = await import("../../src/remote-control/session-voice-history");
	const { voiceDelegation } = await import("../../src/remote-control/voice-delegation");
	const auth = await AuthStorage.create(":memory:");
	const model = getBundledModel("openai", "gpt-4o-mini")!;
	const manager = SessionManager.inMemory();
	const session = new AgentSession({
		agent: new Agent({ initialState: { model } }),
		sessionManager: manager,
		settings: Settings.isolated({ "compaction.enabled": false }),
		modelRegistry: new ModelRegistry(auth),
	});
	const owner = getSessionVoiceHistory(session);
	const segments = () =>
		manager
			.getBranch()
			.filter(
				entry =>
					entry.type === "custom" &&
					entry.customType === "remote-realtime" &&
					(entry.data as any)?.item?.type === "transcriptSegment",
			);
	try {
		await owner.history.start("voice");
		await owner.history.transcript("user", "Pending speech", false);
		await session.steer(voiceDelegation("Work", "user: Pending speech"));
		expect(segments()).toHaveLength(0);
		await session.steer("Typed work");
		expect(segments()).toHaveLength(1);
		expect(session.queuedMessageCount).toBe(2);
		await owner.history.close(false);
	} finally {
		await session.dispose();
		auth.close();
	}
});
