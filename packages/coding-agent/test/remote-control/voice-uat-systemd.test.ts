import { expect, test } from "bun:test";
import { replaceSystemdVoiceService } from "../../src/remote-control/voice-uat-systemd";

test("candidate replacement quiesces the running executable before starting the unit", async () => {
	const calls: string[] = [];
	const states = [
		{ MainPID: "42", ActiveState: "active", SubState: "running" },
		{ MainPID: "0", ActiveState: "deactivating", SubState: "stop" },
		{ MainPID: "0", ActiveState: "inactive", SubState: "dead" },
	];
	await replaceSystemdVoiceService({
		unit: "xcsh-remote-control.service",
		properties: async () => states.shift() ?? { MainPID: "0", ActiveState: "inactive", SubState: "dead" },
		resolveExecutable: async path => {
			calls.push(`resolve:${path}`);
			return "/candidate/xcsh-linux-x64";
		},
		command: async argv => {
			calls.push(argv.join(" "));
			return "";
		},
		wait: async milliseconds => {
			calls.push(`wait:${milliseconds}`);
		},
	});
	expect(calls).toEqual([
		"resolve:/proc/42/exe",
		"/candidate/xcsh-linux-x64 remote-control quiesce",
		"wait:500",
		"systemctl --user start xcsh-remote-control.service",
	]);
});

test("an inactive service starts without a redundant quiesce request", async () => {
	const calls: string[] = [];
	await replaceSystemdVoiceService({
		unit: "xcsh-remote-control.service",
		properties: async () => ({ MainPID: "0", ActiveState: "inactive", SubState: "dead" }),
		resolveExecutable: async () => {
			throw new Error("inactive services have no executable");
		},
		command: async argv => {
			calls.push(argv.join(" "));
			return "";
		},
		wait: async () => {},
	});
	expect(calls).toEqual(["systemctl --user start xcsh-remote-control.service"]);
});
