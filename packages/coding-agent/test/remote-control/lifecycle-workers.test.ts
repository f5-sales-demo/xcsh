import { expect, test } from "bun:test";
import { verifiedLifecycleWorkers } from "../../scripts/lifecycle-worker-inspection";
import { lifecycleRuntimeProcessIds } from "../../src/remote-control/lifecycle-uat-controller";

const executable = "/fixture/artifacts/xcsh-linux-x64";
const sha256 = "a".repeat(64);
const root = "/fixture/remote-control";
const socket = `${root}/workers/fixture.sock`;
const candidate = { executable, sha256 };
const worker = {
	uid: 502,
	pid: 12,
	ppid: 11,
	executable,
	startTime: "100",
	sha256,
	argv: [executable, "remote-control", "worker", socket],
	socketInodes: ["77"],
};
const record = {
	id: "thread-fixture",
	workerSocket: socket,
	workerProcess: {
		pid: 12,
		startTime: "100",
		executablePath: executable,
		executableSha256: sha256,
		generation: 0,
	},
};
const catalog = { version: 1, threads: [record] };
const rows = [{ uid: 502, pid: 10, ppid: 1, executable }, { uid: 502, pid: 11, ppid: 10, executable }, worker];
const listening = new Map([[socket, "77"]]);
test("registered chat workers pass preflight while an unregistered process remains unexpected", () => {
	const workers = verifiedLifecycleWorkers(rows, 502, candidate, root, catalog, listening);
	expect(workers).toMatchObject([{ threadId: "thread-fixture", pid: 12, startTime: "100", sha256 }]);
	expect(lifecycleRuntimeProcessIds([...rows, { ...worker, pid: 13 }], 502, 10, executable, workers)).toEqual({
		childPid: 11,
		unexpectedProcesses: [13],
	});
});
test("a worker adopted after relay-host replacement retains its exact ownership", () => {
	const adopted = [...rows.slice(0, 2), { ...worker, ppid: 1 }];
	const workers = verifiedLifecycleWorkers(adopted, 502, candidate, root, catalog, listening);
	expect(lifecycleRuntimeProcessIds(adopted, 502, 10, executable, workers).unexpectedProcesses).toEqual([]);
});
test.each([
	{ startTime: "101" },
	{ sha256: "b".repeat(64) },
	{ executable: "/old/artifact/xcsh-linux-x64" },
	{ argv: [executable, "remote-control", "pair"] },
	{ socketInodes: ["different"] },
])("PID reuse, artifact drift, wrong command, and socket mismatch cannot authorize a worker %#", mismatch => {
	const changed = [...rows.slice(0, 2), { ...worker, ...mismatch }];
	const workers = verifiedLifecycleWorkers(changed, 502, candidate, root, catalog, listening);
	expect(workers).toEqual([]);
	expect(lifecycleRuntimeProcessIds(changed, 502, 10, executable, workers).unexpectedProcesses).toEqual([12]);
});
test.each(["/elsewhere/fixture.sock", `${root}/workers/../escape.sock`])(
	"catalog socket escape is rejected: %s",
	path => {
		expect(() =>
			verifiedLifecycleWorkers(
				rows,
				502,
				candidate,
				root,
				{ version: 1, threads: [{ ...record, workerSocket: path }] },
				listening,
			),
		).toThrow("Invalid managed worker catalog");
	},
);
test("malformed or ambiguous catalog cannot create an allowlist", () => {
	for (const invalid of [
		{},
		{ version: 2, threads: [] },
		{ version: 1, threads: [record, { ...record, id: "second-thread" }] },
	]) {
		expect(() => verifiedLifecycleWorkers(rows, 502, candidate, root, invalid, listening)).toThrow(
			"Invalid managed worker catalog",
		);
	}
});
test("dead historical records do not authorize another live process", () => {
	const history = { version: 1, threads: [{ ...record, workerProcess: { ...record.workerProcess, pid: 99 } }] };
	const workers = verifiedLifecycleWorkers(rows, 502, candidate, root, history, listening);
	expect(workers).toEqual([]);
	expect(lifecycleRuntimeProcessIds(rows, 502, 10, executable, workers).unexpectedProcesses).toEqual([12]);
});
