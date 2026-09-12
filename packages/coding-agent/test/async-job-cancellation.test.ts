import { expect, test } from "bun:test";
import { type AsyncJob, AsyncJobManager } from "../src/async/job-manager";

test("cancelled jobs remain tracked until their executor settles, even with zero retention", async () => {
	const release = Promise.withResolvers<string>();
	const manager = new AsyncJobManager({ retentionMs: 0, onJobComplete: () => {} });
	const id = manager.register("bash", "fixture", () => release.promise);
	try {
		manager.cancel(id);
		expect(manager.getJob(id)?.status).toBe("cancelled");
		let settled = false;
		const waiting = manager.waitForAll().then(() => {
			settled = true;
		});
		await Bun.sleep(10);
		expect(settled).toBe(false);
		release.resolve("stopped");
		await waiting;
		expect(manager.getJob(id)).toBeUndefined();
	} finally {
		release.resolve("stopped");
		await manager.dispose();
	}
});

test("cancellation settlement delivers executor facts once without normal follow-up delivery", async () => {
	const release = Promise.withResolvers<void>();
	const cancelled: AsyncJob[] = [];
	let prompts = 0;
	const manager = new AsyncJobManager({
		onJobComplete: () => {
			prompts++;
		},
		onJobCancelled: (job: AsyncJob) => {
			cancelled.push(job);
		},
	});
	const id = manager.register("bash", "fixture", async ({ reportProgress }) => {
		await release.promise;
		await reportProgress("stopped", { execution: { status: "failed", exitCode: null } });
		throw new Error("stopped");
	});
	manager.watchJobs([id]);
	manager.acknowledgeDeliveries([id]);
	manager.cancel(id);
	manager.cancel(id);
	expect(cancelled).toHaveLength(0);
	release.resolve();
	await manager.waitForAll();
	await manager.drainDeliveries({ timeoutMs: 2000 });
	expect(prompts).toBe(0);
	expect(cancelled).toHaveLength(1);
	expect(cancelled[0]).toMatchObject({
		id,
		status: "cancelled",
		resultDetails: { execution: { status: "failed", exitCode: null } },
	});
	await manager.dispose();
});

test("cancellation settlement retries retain the original job after display retention expires", async () => {
	const release = Promise.withResolvers<string>();
	const seen: AsyncJob[] = [];
	const manager = new AsyncJobManager({
		retentionMs: 0,
		onJobComplete: () => {},
		onJobCancelled: (job: AsyncJob) => {
			seen.push(job);
			if (seen.length === 1) throw new Error("Fixture persistence retry");
		},
	});
	const id = manager.register("bash", "fixture", () => release.promise);
	manager.cancel(id);
	release.resolve("stopped");
	await manager.waitForAll();
	expect(await manager.drainDeliveries({ timeoutMs: 2000 })).toBe(true);
	expect(seen).toHaveLength(2);
	expect(seen[0]).toBe(seen[1]);
	expect(seen[1]).toMatchObject({ id, status: "cancelled", resultText: "stopped" });
	await manager.dispose();
});

test("a pending completion prevents job-id reuse after retention eviction", async () => {
	const release = Promise.withResolvers<void>();
	const manager = new AsyncJobManager({ retentionMs: 0, onJobComplete: () => release.promise });
	try {
		const first = manager.register("bash", "first", async () => "done");
		await manager.waitForAll();
		const second = manager.register("bash", "second", async () => "done");
		expect(second).not.toBe(first);
	} finally {
		release.resolve();
		await manager.dispose();
	}
});

test("acknowledging an in-flight normal delivery cannot discard a queued cancellation receipt", async () => {
	const normalDelivery = Promise.withResolvers<void>();
	const cancelExecution = Promise.withResolvers<string>();
	const entered = Promise.withResolvers<void>();
	const cancelled: string[] = [];
	const manager = new AsyncJobManager({
		onJobComplete: async () => {
			entered.resolve();
			await normalDelivery.promise;
		},
		onJobCancelled: job => {
			cancelled.push(job.id);
		},
	});
	try {
		const normal = manager.register("task", "normal", async () => "done");
		await entered.promise;
		manager.acknowledgeDeliveries([normal]);
		const id = manager.register("bash", "cancelled", () => cancelExecution.promise);
		manager.cancel(id);
		cancelExecution.resolve("stopped");
		await manager.waitForAll();
		normalDelivery.resolve();
		expect(await manager.drainDeliveries({ timeoutMs: 2000 })).toBe(true);
		expect(cancelled).toEqual([id]);
	} finally {
		normalDelivery.resolve();
		cancelExecution.resolve("stopped");
		await manager.dispose();
	}
});
