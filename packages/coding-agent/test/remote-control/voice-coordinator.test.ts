import { expect, test } from "bun:test";
import { VoiceCoordinator } from "../../src/remote-control/voice-coordinator";

test("one chat has one audio owner; takeover closes the previous call before admission", async () => {
	const coordinator = new VoiceCoordinator("chat-fixture");
	const log: string[] = [];
	const first = await coordinator.acquire("terminal", async () => {
		log.push("closed");
	});
	await expect(coordinator.acquire("browser", async () => {})).rejects.toThrow("takeover");
	const second = await coordinator.acquire("browser", async () => {}, first.revision);
	expect(log).toEqual(["closed"]);
	expect(coordinator.owns(first)).toBe(false);
	expect(coordinator.owns(second)).toBe(true);
	coordinator.release(first);
	expect(coordinator.owns(second)).toBe(true);
});

test("concurrent admissions and stale takeover revisions cannot share audio", async () => {
	const coordinator = new VoiceCoordinator("chat-fixture");
	const results = await Promise.allSettled([
		coordinator.acquire("a", async () => {}),
		coordinator.acquire("b", async () => {}),
	]);
	expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
	const lease = (results.find(result => result.status === "fulfilled") as PromiseFulfilledResult<any>).value;
	await expect(coordinator.acquire("c", async () => {}, lease.revision - 1)).rejects.toThrow("takeover");
});

test("failed cleanup retains ownership and refuses a replacement", async () => {
	const coordinator = new VoiceCoordinator("chat-fixture");
	const lease = await coordinator.acquire("a", async () => {
		throw new Error("cleanup uncertain");
	});
	await expect(coordinator.acquire("b", async () => {}, lease.revision)).rejects.toThrow("cleanup uncertain");
	expect(coordinator.owns(lease)).toBe(true);
});
