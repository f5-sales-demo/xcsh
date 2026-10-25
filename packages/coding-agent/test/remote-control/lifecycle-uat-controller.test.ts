import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type LifecycleAttempt,
	type LifecycleCampaign,
	type LifecycleCase,
	LifecycleController,
	type LifecycleHost,
	lifecycleCaseFailures,
	lifecycleRuntimeProcessIds,
	validateLifecycleCapture,
} from "../../src/remote-control/lifecycle-uat-controller";

const identity = {
	machine: "machine-fixture",
	server: "server-fixture",
	workspace: "workspace-fixture",
	pane: "pane-fixture",
	execution: "execution-fixture",
	phoneBuild: "phone-build-fixture",
	client: "client-fixture",
	stream: "stream-fixture",
	thread: "thread-fixture",
	call: "call-fixture",
};
const candidate = { commit: "a".repeat(40), sha256: "b".repeat(64), version: "1.0.0", executable: "/artifact/xcsh" };
const definition: LifecycleCase = {
	schemaVersion: 1,
	id: "T02",
	dependencies: [],
	startingState: "fresh conversation",
	fixture: "synthetic-message",
	action: "submit one message",
	expectedTransition: "one admitted turn",
	identities: ["machine", "server", "workspace", "pane", "execution", "phoneBuild", "client", "stream", "thread"],
	gates: ["unit", "installed", "reference", "physical"],
	requiredReceipts: ["preflight-3x10s", "post-close-60s"],
	expectedMethods: ["turn/start", "turn/completed"],
	timeoutMs: 30_000,
	cleanup: "remove disposable fixture",
	explanation: "one phone action maps to one server transition",
	required: true,
	runtime: "running",
};
function campaign(): LifecycleCampaign {
	return {
		schemaVersion: 1,
		id: "campaign-fixture",
		createdAtUnixMs: 1,
		candidate,
		reference: {
			tag: "rust-v0.159.2",
			commit: "c".repeat(40),
			packageSha256: "d".repeat(64),
			schemaSha256: "e".repeat(64),
			qualified: true,
		},
		phoneBuild: identity.phoneBuild,
		cases: [definition],
		controls: [
			{
				label: "Send",
				screen: "conversation",
				available: true,
				referenceBehavior: "admits one turn",
				methods: ["turn/start"],
				caseIds: ["T02"],
			},
		],
		catalogFrozen: true,
		coreCaseIds: ["T02"],
		coreRepeats: 2,
	};
}
const runtime = {
	executable: candidate.executable,
	sha256: candidate.sha256,
	supervisorPid: 10,
	childPid: 11,
	invocation: "invocation-fixture",
	configSha256: "f".repeat(64),
	argumentsSha256: "0".repeat(64),
	restarts: 0,
	unexpectedProcesses: [] as number[],
};
function attempt(): LifecycleAttempt {
	return {
		schemaVersion: 1,
		id: "attempt-fixture",
		campaignId: "campaign-fixture",
		caseId: "T02",
		cycle: 0,
		startedAtUnixMs: 1,
		finishedAtUnixMs: 10,
		candidate,
		identities: identity,
		startRuntime: runtime,
		endRuntime: runtime,
		gates: [],
		receipts: [],
		artifacts: [],
		findings: [],
	};
}
test("lifecycle combined acceptance cannot promote unit success into physical success", () => {
	const a = attempt();
	a.gates.push({ gate: "unit", outcome: "pass", artifactSha256: "1".repeat(64) });
	expect(lifecycleCaseFailures(campaign(), definition, a)).toContain("missing-gate:physical");
	expect(lifecycleCaseFailures(campaign(), definition, a)).toContain("missing-gate:installed");
});
test("runtime replacement and client identity loss invalidate lifecycle acceptance", () => {
	const a = attempt();
	a.endRuntime = { ...runtime, childPid: 12 };
	a.identities = { ...identity, stream: "" };
	expect(lifecycleCaseFailures(campaign(), definition, a)).toContain("runtime-changed");
	expect(lifecycleCaseFailures(campaign(), definition, a)).toContain("missing-identity:stream");
});
test("lifecycle trace validation rejects missing footers, sequence gaps, provenance and identity mismatches", () => {
	const rows = [
		{ kind: "manifest", sourceCommit: candidate.commit, artifactSha256: candidate.sha256 },
		{ kind: "event", sequence: 1, message: { method: "turn/start", params: { threadId: "fixture-thread" } } },
		{ kind: "footer", complete: true, events: 1 },
	];
	expect(validateLifecycleCapture(rows, candidate, ["turn/start"])).toEqual([]);
	expect(validateLifecycleCapture(rows.slice(0, -1), candidate, [])).toContain("incomplete-capture");
	expect(
		validateLifecycleCapture([{ ...rows[0], sourceCommit: "9".repeat(40) }, ...rows.slice(1)], candidate, []),
	).toContain("capture-provenance");
	expect(validateLifecycleCapture([rows[0], { ...rows[1], sequence: 2 }, rows[2]], candidate, [])).toContain(
		"capture-sequence",
	);
});
test("lifecycle prepare is exclusive and candidate changes require a new campaign", async () => {
	const root = await mkdtemp(join(tmpdir(), "lifecycle-"));
	const host: LifecycleHost = { inspect: async () => runtime, verifyArtifact: async () => true };
	try {
		const controller = new LifecycleController(root, host);
		await controller.prepare(campaign());
		await expect(
			controller.prepare({ ...campaign(), candidate: { ...candidate, commit: "9".repeat(40) } }),
		).rejects.toThrow("exists");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("lifecycle finalization recomputes gates and cannot trust edited status files", async () => {
	const root = await mkdtemp(join(tmpdir(), "lifecycle-"));
	const host: LifecycleHost = { inspect: async () => runtime, verifyArtifact: async () => true };
	try {
		const controller = new LifecycleController(root, host);
		await controller.prepare(campaign());
		await writeFile(join(root, "status.json"), JSON.stringify({ completed: true }));
		await expect(controller.finalize()).rejects.toThrow("incomplete");
		const status = await controller.status();
		expect(status.complete).toBe(false);
		expect(status.cases.T02).toBe("pending");
		const bytes = await readFile(join(root, "campaign.json"), "utf8");
		await writeFile(join(root, "campaign.json"), bytes.replace('"qualified": true', '"qualified": false'));
		await expect(controller.status()).rejects.toThrow("integrity");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("lifecycle attempts are append-only and failures remain after resume and invalidation", async () => {
	const root = await mkdtemp(join(tmpdir(), "lifecycle-"));
	const host: LifecycleHost = { inspect: async () => runtime, verifyArtifact: async () => true };
	try {
		const controller = new LifecycleController(root, host);
		await controller.prepare(campaign());
		await controller.startCase("T02", identity);
		await controller.invalidate("disconnect-fixture");
		await controller.resume();
		await controller.startCase("T02", identity);
		await controller.invalidate("second-failure-fixture");
		const log = await readFile(join(root, "events.jsonl"), "utf8");
		expect(log).toContain("disconnect-fixture");
		expect(log).toContain("second-failure-fixture");
		expect((await controller.status()).attempts).toBe(2);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("unit evidence must contain a successful command receipt bound to the exact attempt", async () => {
	const root = await mkdtemp(join(tmpdir(), "lifecycle-"));
	const host: LifecycleHost = { inspect: async () => runtime, verifyArtifact: async () => true };
	try {
		const controller = new LifecycleController(root, host);
		await controller.prepare(campaign());
		await controller.startCase("T02", identity);
		const file = join(root, "forged-unit.json");
		await writeFile(file, JSON.stringify({ outcome: "pass" }));
		await expect(controller.recordGate("unit", file, "pass")).rejects.toThrow("evidence binding");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("physical evidence contents must equal the imported observation record", async () => {
	const root = await mkdtemp(join(tmpdir(), "lifecycle-"));
	const host: LifecycleHost = { inspect: async () => runtime, verifyArtifact: async () => true };
	try {
		const controller = new LifecycleController(root, host);
		await controller.prepare(campaign());
		await controller.startCase("T02", identity);
		const file = join(root, "wrong-observation.json");
		await writeFile(file, JSON.stringify({ outcome: "fail" }));
		await expect(
			controller.importHuman(
				{ phoneBuild: identity.phoneBuild, identities: identity, outcome: "pass", observedUi: "complete" },
				file,
			),
		).rejects.toThrow("evidence contents");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("core acceptance runs must follow the frozen core order", async () => {
	const root = await mkdtemp(join(tmpdir(), "lifecycle-"));
	const host: LifecycleHost = { inspect: async () => runtime, verifyArtifact: async () => true };
	try {
		const controller = new LifecycleController(root, host);
		await controller.prepare({
			...campaign(),
			cases: [{ ...definition, id: "T01" }, definition],
			coreCaseIds: ["T01", "T02"],
		});
		await expect(controller.startCase("T02", identity, 1)).rejects.toThrow("Core sequence");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("runtime ownership follows proc executable identity rather than truncated process names", () => {
	const rows = [
		{ uid: 502, pid: 10, ppid: 1, executable: candidate.executable },
		{ uid: 502, pid: 11, ppid: 10, executable: candidate.executable },
		{ uid: 502, pid: 12, ppid: 1, executable: "/another/artifact/xcsh-linux-x64" },
	];
	expect(lifecycleRuntimeProcessIds(rows, 502, 10, candidate.executable)).toEqual({
		childPid: 11,
		unexpectedProcesses: [12],
	});
	expect(
		lifecycleRuntimeProcessIds(
			[...rows, { uid: 502, pid: 13, ppid: 10, executable: candidate.executable }],
			502,
			10,
			candidate.executable,
		).childPid,
	).toBe(0);
});
test("capture envelopes must carry the exact requesting identities", () => {
	const rows = [
		{ kind: "manifest", sourceCommit: candidate.commit, artifactSha256: candidate.sha256 },
		{ kind: "event", sequence: 1, message: { method: "turn/start" } },
		{ kind: "footer", complete: true, events: 1 },
	];
	expect(validateLifecycleCapture(rows, candidate, [], { client: "expected-client" })).toContain(
		"capture-identity:client",
	);
});
test("preflight validates worker artifact provenance rather than trusting an allowlisted PID", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-worker-provenance-"));
	const worker = {
		threadId: "thread-fixture",
		pid: 12,
		startTime: "10",
		executable: candidate.executable,
		sha256: "f".repeat(64),
		socket: "/tmp/worker.sock",
		socketInode: "1",
	};
	const controller = new LifecycleController(root, {
		verifyArtifact: async () => true,
		inspect: async () => ({ ...runtime, workers: [worker] }),
	});
	try {
		await controller.prepare(campaign());
		await expect(controller.preflight()).rejects.toThrow("worker-provenance");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("first worker creation is allowed but replacement of an existing thread owner invalidates the attempt", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-worker-transition-"));
	const worker = {
		threadId: identity.thread,
		pid: 12,
		startTime: "10",
		executable: candidate.executable,
		sha256: candidate.sha256,
		socket: "/tmp/worker.sock",
		socketInode: "1",
	};
	let current = { ...runtime, workers: [] as (typeof worker)[] };
	const controller = new LifecycleController(root, { verifyArtifact: async () => true, inspect: async () => current });
	try {
		await controller.prepare(campaign());
		await controller.startCase("T02", identity);
		current = { ...runtime, workers: [worker] };
		expect(await controller.finishCase()).not.toContain("runtime-changed");
		await controller.startCase("T02", identity);
		current = { ...runtime, workers: [{ ...worker, pid: 13, startTime: "11" }] };
		expect(await controller.finishCase()).toContain("runtime-changed");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("losing the case's existing thread worker invalidates ownership", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-worker-loss-"));
	const worker = {
		threadId: identity.thread,
		pid: 12,
		startTime: "10",
		executable: candidate.executable,
		sha256: candidate.sha256,
		socket: "/tmp/worker.sock",
		socketInode: "1",
	};
	let current = { ...runtime, workers: [worker] };
	const controller = new LifecycleController(root, { verifyArtifact: async () => true, inspect: async () => current });
	try {
		await controller.prepare(campaign());
		await controller.startCase("T02", identity);
		current = { ...runtime, workers: [] };
		expect(await controller.finishCase()).toContain("worker-owner-lost");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
