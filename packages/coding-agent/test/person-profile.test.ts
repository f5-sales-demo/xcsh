import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersonProfileService } from "../src/person-profile/service";

const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true, force: true })));
});
async function setup() {
	const dir = await mkdtemp(join(tmpdir(), "person-test-"));
	dirs.push(dir);
	const path = join(dir, "private", "user-profile.json");
	return { path, service: new PersonProfileService(path) };
}
test("missing profile is explicit and reads never create storage", async () => {
	const { path, service } = await setup();
	expect(await service.get()).toMatchObject({ state: "empty", revision: 0, facts: {} });
	expect(await Bun.file(path).exists()).toBe(false);
});
test("user correction owns fields and forgetting suppresses collectors without retaining values", async () => {
	const { service } = await setup();
	service.registerProfileCollector({
		id: "synthetic",
		name: "Synthetic",
		available: async () => true,
		collect: async () => ({ givenName: "Person-A" }),
	});
	await service.refresh(["synthetic"]);
	await service.update({ givenName: "Person-B" });
	await service.refresh(["synthetic"]);
	expect((await service.get()).facts.givenName).toBe("Person-B");
	await service.forget(["givenName"]);
	await service.refresh(["synthetic"]);
	const profile = await service.get();
	expect(profile.facts.givenName).toBeUndefined();
	expect(JSON.stringify(profile)).not.toContain("Person-");
	expect(profile.suppressed.givenName).toBeDefined();
});
test("four sessions serialize updates and revisions survive restart", async () => {
	const { path } = await setup();
	const fields = [
		{ givenName: "Person-A" },
		{ familyName: "Example" },
		{ jobTitle: "Engineer" },
		{ knowsLanguage: ["en"] },
	];
	await Promise.all(fields.map(f => new PersonProfileService(path).update(f)));
	const profile = await new PersonProfileService(path).get();
	expect(profile.revision).toBe(4);
	expect(Object.keys(profile.facts)).toHaveLength(4);
	await expect(new PersonProfileService(path).update({ givenName: "Person-C" }, 0)).rejects.toThrow(
		"revision conflict",
	);
	expect((await stat(path)).mode & 0o777).toBe(0o600);
	expect((await stat(join(path, ".."))).mode & 0o777).toBe(0o700);
});
test("invalid stores remain intact and errors exclude content", async () => {
	const { path, service } = await setup();
	await service.update({ givenName: "Person-A" });
	const bad = '{"private":"sentinel-invalid"';
	await writeFile(path, bad);
	await expect(service.get()).rejects.toThrow("Invalid person profile");
	await expect(service.update({ givenName: "Person-B" })).rejects.toThrow("Invalid person profile");
	expect(await readFile(path, "utf8")).toBe(bad);
});
test("invalid input, cancelled writes and separate stores never mutate another person", async () => {
	const { service } = await setup();
	const other = await setup();
	await expect(service.update({ unknown: "sentinel" } as never)).rejects.toThrow("Invalid person profile");
	const abort = new AbortController();
	abort.abort();
	await expect(service.update({ givenName: "Person-A" }, undefined, abort.signal)).rejects.toThrow();
	expect((await other.service.get()).state).toBe("empty");
	expect((await service.get()).revision).toBe(0);
});

test("person tool blocks Plan writes and cancels pending Ask approval", async () => {
	const { service } = await setup();
	const { PersonProfileTool } = await import("../src/tools/person-profile");
	const { applyRemotePermissionProfile } = await import("../src/sandbox/remote-permissions");
	const settings = { get: () => false, override: () => {} };
	const session = {
		cwd: "/tmp",
		settings,
		personProfileService: service,
		getPlanModeState: () => ({ enabled: true, planFilePath: "/tmp/plan.md" }),
	};
	const tool = new PersonProfileTool(session as never);
	await expect(
		tool.execute("one", { action: "update", facts: { givenName: "Person-A" }, revision: 0 }),
	).rejects.toThrow("Plan mode");
	session.getPlanModeState = () => undefined as never;
	applyRemotePermissionProfile(settings, {
		approvalPolicy: "on-request",
		approvalsReviewer: "user",
		sandboxPolicy: {
			type: "workspaceWrite",
			writableRoots: ["/tmp"],
			networkAccess: false,
			excludeTmpdirEnvVar: false,
			excludeSlashTmp: false,
		},
		activePermissionProfile: { id: ":workspace" },
	});
	let approve: ((value: string) => void) | undefined;
	const abort = new AbortController();
	const pending = tool.execute(
		"two",
		{ action: "update", facts: { givenName: "Person-A" }, revision: 0 },
		abort.signal,
		undefined,
		{
			hasUI: true,
			ui: {
				select: () =>
					new Promise<string>(resolve => {
						approve = resolve;
					}),
			},
		} as never,
	);
	await Bun.sleep(5);
	expect(approve).toBeDefined();
	abort.abort();
	approve?.("Allow once");
	await expect(pending).rejects.toThrow("cancelled");
	expect((await service.get()).revision).toBe(0);
});

test("canonical resources share the tool store and reject mutating reads", async () => {
	const { service } = await setup();
	const { InternalDocsProtocolHandler } = await import("../src/internal-urls/xcsh-protocol");
	const { InternalUrlRouter } = await import("../src/internal-urls/router");
	const router = new InternalUrlRouter();
	router.register(new InternalDocsProtocolHandler({ personProfileService: service }));
	expect(JSON.parse((await router.resolve("xcsh://user")).content).state).toBe("empty");
	await service.update({ jobTitle: "Synthetic engineer" });
	expect(JSON.parse((await router.resolve("xcsh://user")).content).facts.jobTitle).toBe("Synthetic engineer");
	expect(JSON.parse((await router.resolve("xcsh://user/schema")).content).properties.schemaVersion.const).toBe(1);
	await expect(router.resolve("xcsh://user?seed=true")).rejects.toThrow("Unsupported person profile route");
});

test("collector failure is sanitized and inferred observations never become facts", async () => {
	const { service } = await setup();
	service.registerProfileCollector({
		id: "broken",
		name: "Broken",
		available: async () => true,
		collect: async () => {
			throw new Error("private-sentinel");
		},
	});
	const refreshed = await service.refresh(["broken"]);
	expect(refreshed.collectors).toEqual([{ id: "broken", status: "error" }]);
	expect(JSON.stringify(refreshed)).not.toContain("private-sentinel");
	await service.observe([
		{
			field: "jobTitle",
			value: "Possible engineer",
			kind: "inferred",
			source: "inference",
			observedAt: new Date().toISOString(),
		},
	]);
	expect((await service.get()).facts.jobTitle).toBeUndefined();
	expect((await service.get()).observations[0].kind).toBe("inferred");
	await service.forget(["jobTitle"]);
	expect((await service.get()).observations).toHaveLength(0);
});

test("four independent processes share one store without lost updates", async () => {
	const { path, service } = await setup();
	const modulePath = new URL("../src/person-profile/service.ts", import.meta.url).pathname;
	const children = [
		{ givenName: "Person-A" },
		{ familyName: "Example" },
		{ jobTitle: "Engineer" },
		{ knowsLanguage: ["en"] },
	].map(facts =>
		Bun.spawn(
			[
				process.execPath,
				"-e",
				`import {PersonProfileService} from ${JSON.stringify(modulePath)}; await new PersonProfileService(${JSON.stringify(path)}).update(${JSON.stringify(facts)});`,
			],
			{ stdout: "ignore", stderr: "pipe" },
		),
	);
	expect(await Promise.all(children.map(c => c.exited))).toEqual([0, 0, 0, 0]);
	expect((await service.get()).revision).toBe(4);
	expect(Object.keys((await service.get()).facts)).toHaveLength(4);
});

test("reconciliation requires explicit source configuration", async () => {
	const { service } = await setup();
	let calls = 0;
	service.registerProfileCollector({
		id: "configured",
		name: "Configured",
		available: async () => true,
		collect: async () => {
			calls++;
			return { jobTitle: "Synthetic engineer" };
		},
	});
	await service.reconcileFromCollectors();
	expect(calls).toBe(0);
	await service.refresh(["configured"], 0, undefined, true);
	await service.reconcileFromCollectors();
	expect(calls).toBe(2);
	const profile = await service.get();
	await service.update({ jobTitle: "Corrected engineer" }, profile.revision);
	await service.reconcileFromCollectors();
	expect((await service.get()).facts.jobTitle).toBe("Corrected engineer");
});

test("repeated normalized updates are idempotent and collectors cannot steal ownership", async () => {
	const { service } = await setup();
	await service.update({ givenName: " Person-A " });
	await service.update({ givenName: "Person-A" });
	expect((await service.get()).revision).toBe(1);
	service.registerProfileCollector({
		id: "first",
		name: "First",
		available: async () => true,
		collect: async () => ({ jobTitle: "First title" }),
	});
	service.registerProfileCollector({
		id: "second",
		name: "Second",
		available: async () => true,
		collect: async () => ({ jobTitle: "Second title" }),
	});
	await service.refresh(["first", "second"]);
	expect((await service.get()).facts.jobTitle).toBe("First title");
	expect((await service.get()).provenance.jobTitle?.source).toBe("first");
});
test("Linux GECOS uses the fifth field, not shell or home", async () => {
	const { parseGecos } = await import("../src/person-profile/collectors");
	expect(parseGecos("synthetic:x:1000:1000:Person Example,Room:/tmp/synthetic-home:/bin/sh")).toBe("Person Example");
	expect(parseGecos("invalid")).toBe("");
});

test("suppression storage cannot retain unknown fields or hidden values", async () => {
	const { path, service } = await setup();
	const profile = await service.update({ givenName: "Synthetic" });
	await writeFile(path, JSON.stringify({ ...profile, suppressed: { unknown: { value: "synthetic-hidden" } } }));
	await expect(service.get()).rejects.toThrow("Invalid person profile storage");
});

test("extension collectors can reload across sessions without another extension taking ownership", async () => {
	const { service } = await setup();
	const collector = {
		id: "extension_synthetic",
		name: "Synthetic",
		available: async () => true,
		collect: async () => ({ givenName: "Synthetic" }),
	};
	service.registerProfileCollector(collector, "extension-one");
	expect(() => service.registerProfileCollector({ ...collector }, "extension-one")).not.toThrow();
	expect(() => service.registerProfileCollector({ ...collector }, "extension-two")).toThrow(
		"Invalid person profile collector",
	);
	await service.refresh([collector.id]);
	expect((await service.get()).provenance.givenName?.owner).toBe(collector.id);
});

test("Salesforce does not invent an employer when its record omits the company", async () => {
	const { parseSalesforceUserRecord } = await import("../src/person-profile/collectors");
	expect(parseSalesforceUserRecord({ FirstName: "Synthetic" }).worksFor).toBeUndefined();
});

test("Ask reviews proposed facts, declines safely and checks revision after approval; Full writes directly", async () => {
	const { service } = await setup();
	const { PersonProfileTool } = await import("../src/tools/person-profile");
	const { applyRemotePermissionProfile } = await import("../src/sandbox/remote-permissions");
	const settings = { get: () => false, override: () => {} };
	const tool = new PersonProfileTool({ cwd: "/tmp", settings, personProfileService: service } as never);
	await tool.execute("full", { action: "update", facts: { givenName: "Synthetic" }, revision: 0 });
	applyRemotePermissionProfile(settings, {
		approvalPolicy: "on-request",
		approvalsReviewer: "user",
		sandboxPolicy: {
			type: "workspaceWrite",
			writableRoots: ["/tmp"],
			networkAccess: false,
			excludeTmpdirEnvVar: false,
			excludeSlashTmp: false,
		},
		activePermissionProfile: { id: ":workspace" },
	});
	const args = { action: "update" as const, facts: { jobTitle: "Synthetic engineer" }, revision: 1 };
	await expect(tool.execute("no-owner", args)).rejects.toThrow("approval unavailable");
	await expect(
		tool.execute("decline", args, undefined, undefined, {
			hasUI: true,
			ui: { select: async () => "Decline" },
		} as never),
	).rejects.toThrow("declined");
	await expect(
		tool.execute("stale", args, undefined, undefined, {
			hasUI: true,
			ui: {
				select: async (proposal: string) => {
					expect(proposal).toContain(JSON.stringify(args.facts));
					await service.update({ jobTitle: "Corrected synthetic role" }, 1);
					return "Allow once";
				},
			},
		} as never),
	).rejects.toThrow("revision conflict");
	expect((await service.get()).facts.jobTitle).toBe("Corrected synthetic role");
});
