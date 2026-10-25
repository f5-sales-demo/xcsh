import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { replaceSystemdVoiceService, withSignalSafeRecovery } from "../../src/remote-control/voice-uat-systemd";

test("candidate replacement quiesces the running executable before starting the unit", async () => {
	const calls: string[] = [];
	const states = [
		{ MainPID: "42", ActiveState: "active", SubState: "running" },
		{ MainPID: "0", ActiveState: "deactivating", SubState: "stop" },
		{ MainPID: "0", ActiveState: "inactive", SubState: "dead" },
	];
	await replaceSystemdVoiceService({
		unit: "xcsh-remote-control.service",
		quiesceExecutable: "/candidate/xcsh-linux-x64",
		properties: async () => states.shift() ?? { MainPID: "0", ActiveState: "inactive", SubState: "dead" },
		command: async argv => {
			calls.push(argv.join(" "));
			return "";
		},
		wait: async milliseconds => {
			calls.push(`wait:${milliseconds}`);
		},
	});
	expect(calls).toEqual([
		"/candidate/xcsh-linux-x64 remote-control quiesce",
		"wait:500",
		"systemctl --user start xcsh-remote-control.service",
	]);
});

test("an inactive service starts without a redundant quiesce request", async () => {
	const calls: string[] = [];
	await replaceSystemdVoiceService({
		unit: "xcsh-remote-control.service",
		quiesceExecutable: "/candidate/xcsh-linux-x64",
		properties: async () => ({ MainPID: "0", ActiveState: "inactive", SubState: "dead" }),
		command: async argv => {
			calls.push(argv.join(" "));
			return "";
		},
		wait: async () => {},
	});
	expect(calls).toEqual(["systemctl --user start xcsh-remote-control.service"]);
});

test("a pidless transitional service settles before replacement", async () => {
	const calls: string[] = [];
	const states = [
		{ MainPID: "0", ActiveState: "deactivating", SubState: "stop" },
		{ MainPID: "0", ActiveState: "inactive", SubState: "dead" },
	];
	await replaceSystemdVoiceService({
		unit: "xcsh-remote-control.service",
		quiesceExecutable: "/candidate/xcsh-linux-x64",
		properties: async () => states.shift() ?? { MainPID: "0", ActiveState: "inactive", SubState: "dead" },
		command: async argv => {
			calls.push(argv.join(" "));
			return "";
		},
		wait: async milliseconds => {
			calls.push(`wait:${milliseconds}`);
		},
	});
	expect(calls).toEqual(["wait:500", "systemctl --user start xcsh-remote-control.service"]);
});

test("an interrupted deployment restores the exact baseline before returning failure", async () => {
	const signals = new EventEmitter();
	let recoveries = 0;
	const order: string[] = [];
	const operation = withSignalSafeRecovery(
		signal =>
			new Promise<void>((_resolve, reject) => {
				signal.addEventListener("abort", () => {
					order.push("operation-stopped");
					reject(new Error("stopped"));
				});
			}),
		async () => {
			recoveries++;
			order.push("baseline-restored");
		},
		signals,
	);
	signals.emit("SIGTERM");
	await expect(operation).rejects.toThrow("SIGTERM");
	expect(recoveries).toBe(1);
	expect(order).toEqual(["operation-stopped", "baseline-restored"]);
	expect(signals.listenerCount("SIGINT")).toBe(0);
	expect(signals.listenerCount("SIGTERM")).toBe(0);
});
