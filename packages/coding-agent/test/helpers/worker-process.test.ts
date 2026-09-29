import { afterEach, expect, test } from "bun:test";
import { spawnWorkerProcess } from "./worker-process";

const workers: Awaited<ReturnType<typeof spawnWorkerProcess>>[] = [];
afterEach(async () => {
	await Promise.all(workers.splice(0).map(worker => worker.stop()));
});

async function fixture(code: string) {
	const worker = await spawnWorkerProcess([process.execPath, "-e", code], { cwd: process.cwd(), env: {} });
	workers.push(worker);
	return worker;
}

test("concurrent subprocess fixtures receive distinct forced ports and cleanup awaits exit", async () => {
	const pair = await Promise.all([fixture("setInterval(() => {}, 1000)"), fixture("setInterval(() => {}, 1000)")]);
	expect(pair[0].port).not.toBe(pair[1].port);
	for (const worker of pair) {
		await worker.stop();
		expect(worker.proc.signalCode).toBe("SIGTERM");
	}
});

test("early worker exit reports its code and bounded stderr instead of exhausting startup retries", async () => {
	const worker = await fixture('console.error("x".repeat(10000) + "STARTUP-FAILURE-END"); process.exit(7)');
	const started = Date.now();
	let message = "";
	try {
		await worker.ready(5000);
	} catch (error) {
		message = String(error);
	}
	expect(message).toContain("exited with code 7");
	expect(message).toContain("STARTUP-FAILURE-END");
	expect(message.length).toBeLessThan(5000);
	expect(Date.now() - started).toBeLessThan(4000);
});

test("a live worker without a bridge fails at the startup deadline and is reaped", async () => {
	const worker = await fixture('console.error("NO-BRIDGE"); setInterval(() => {}, 1000)');
	await expect(worker.ready(500)).rejects.toThrow("startup deadline");
	await worker.stop();
	expect(worker.proc.signalCode).toBe("SIGTERM");
});

test("signal exit is reported even when Bun leaves exitCode null", async () => {
	const worker = await fixture('console.error("SIGNAL-EXIT"); process.kill(process.pid, "SIGTERM")');
	await expect(worker.ready(5000)).rejects.toThrow("signal SIGTERM");
});

test("cleanup force-reaps a subprocess that ignores graceful termination", async () => {
	const worker = await fixture(
		'process.on("SIGTERM", () => {}); console.error("TERM-HANDLER-READY"); setInterval(() => {}, 1000)',
	);
	await expect(worker.ready(1000)).rejects.toThrow("TERM-HANDLER-READY");
	await worker.stop();
	expect(worker.proc.signalCode).toBe("SIGKILL");
});
