import { expect, test } from "bun:test";
import { RemoteProcesses } from "../../src/remote-control/process";
import type { Notification } from "../../src/remote-control/session";

function fixture() {
	const events: { client: string; event: Notification }[] = [];
	const processes = new RemoteProcesses(
		(client, event) => events.push({ client, event }),
		cwd => cwd === "/tmp",
	);
	return { events, processes };
}
async function exitEvent(events: { client: string; event: Notification }[], count = 1) {
	const deadline = Date.now() + 3000;
	while (events.filter(x => x.event.method === "process/exited").length < count && Date.now() < deadline)
		await Bun.sleep(5);
	expect(events.filter(x => x.event.method === "process/exited")).toHaveLength(count);
	return events.filter(x => x.event.method === "process/exited").at(-1)!;
}
test("phone process capture returns actual stdout/stderr/exit and replays without rerunning", async () => {
	const { events, processes } = fixture();
	try {
		const params = {
			processHandle: "fixture",
			cwd: "/tmp",
			command: ["bash", "-c", "printf fixture-output; printf fixture-error >&2; exit 7"],
			tty: false,
			streamStdin: false,
			streamStdoutStderr: false,
			timeoutMs: 1000,
			outputBytesCap: 1024,
		};
		expect(await processes.call("phone", "request", "process/spawn", params)).toEqual({});
		expect(await processes.call("phone", "request", "process/spawn", params)).toEqual({});
		const exit = await exitEvent(events);
		expect(exit).toMatchObject({
			client: "phone",
			event: {
				params: {
					processHandle: "fixture",
					exitCode: 7,
					stdout: "fixture-output",
					stderr: "fixture-error",
					stdoutCapReached: false,
					stderrCapReached: false,
				},
			},
		});
	} finally {
		processes.close();
	}
});
test("streaming output stays client scoped and reports bounded truncation", async () => {
	const { events, processes } = fixture();
	try {
		await processes.call("phone", "request", "process/spawn", {
			processHandle: "fixture",
			cwd: "/tmp",
			command: ["bash", "-c", "printf 123456789"],
			streamStdoutStderr: true,
			outputBytesCap: 4,
		});
		const exit = await exitEvent(events);
		expect(exit.event.params).toMatchObject({ stdout: "", stdoutCapReached: true });
		expect(events.find(x => x.event.method === "process/outputDelta")).toMatchObject({
			client: "phone",
			event: { params: { stream: "stdout", deltaBase64: Buffer.from("1234").toString("base64"), capReached: true } },
		});
	} finally {
		processes.close();
	}
});
test("invalid process requests cannot execute and timeout releases the active handle", async () => {
	const { events, processes } = fixture();
	try {
		await expect(
			processes.call("phone", "bad", "process/spawn", { processHandle: "bad", cwd: "/unknown", command: ["true"] }),
		).rejects.toThrow("working directory");
		await expect(
			processes.call("phone", "pty", "process/spawn", {
				processHandle: "pty",
				cwd: "/tmp",
				command: ["true"],
				tty: true,
			}),
		).rejects.toThrow("PTY");
		await processes.call("phone", "timeout", "process/spawn", {
			processHandle: "fixture",
			cwd: "/tmp",
			command: ["bash", "-c", "sleep 30"],
			timeoutMs: 30,
		});
		await exitEvent(events);
		await processes.call("phone", "reuse", "process/spawn", {
			processHandle: "fixture",
			cwd: "/tmp",
			command: ["true"],
		});
		expect((await exitEvent(events, 2)).event.params.exitCode).toBe(0);
	} finally {
		processes.close();
	}
});

test("failed spawn produces one protocol error and no fabricated exit notification", async () => {
	const { events, processes } = fixture();
	try {
		await expect(
			processes.call("phone", "missing", "process/spawn", {
				processHandle: "fixture",
				cwd: "/tmp",
				command: ["/nonexistent-xcsh-fixture-command"],
			}),
		).rejects.toThrow("Unable to start");
		await Bun.sleep(20);
		expect(events).toEqual([]);
	} finally {
		processes.close();
	}
});

test("stdin, cancellation, and disconnect keep handles isolated between phone clients", async () => {
	const { events, processes } = fixture();
	try {
		await processes.call("phone", "cat", "process/spawn", {
			processHandle: "fixture",
			cwd: "/tmp",
			command: ["cat"],
			streamStdin: true,
		});
		await expect(processes.call("other", "kill", "process/kill", { processHandle: "fixture" })).rejects.toThrow(
			"not found",
		);
		await processes.call("phone", "stdin", "process/writeStdin", {
			processHandle: "fixture",
			deltaBase64: Buffer.from("fixture").toString("base64"),
			closeStdin: true,
		});
		expect((await exitEvent(events)).event.params.stdout).toBe("fixture");
		await processes.call("phone", "sleep", "process/spawn", {
			processHandle: "fixture",
			cwd: "/tmp",
			command: ["sleep", "30"],
		});
		processes.close("phone");
		await Bun.sleep(30);
		expect(events.filter(x => x.event.method === "process/exited")).toHaveLength(1);
	} finally {
		processes.close();
	}
});
