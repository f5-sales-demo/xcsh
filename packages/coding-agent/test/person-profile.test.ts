import { afterEach, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MachineProfileService } from "../src/person-profile/machine-profile";
import { resetProfileTargets } from "../src/person-profile/private-store";
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
	await expect(service.get()).rejects.toThrow("invalid_shape");
	await expect(service.update({ givenName: "Person-B" })).rejects.toThrow("invalid_shape");
	expect(await readFile(path, "utf8")).toBe(bad);
	expect(await service.status()).toMatchObject({ status: "invalid", reason: "invalid_shape" });
	expect(await service.reset()).toBe(true);

	await writeFile(path, "x".repeat(1024 * 1024 + 1), { mode: 0o600 });
	expect(await service.status()).toMatchObject({ status: "invalid", reason: "invalid_shape" });
	expect(await service.reset()).toBe(true);
	const remaining = await import("node:fs/promises").then(fs => fs.readdir(join(path, "..")));
	expect(remaining.some(name => name.startsWith("user-profile.json"))).toBe(false);
	expect(remaining.some(name => /backup|quarantine|migrat/i.test(name))).toBe(false);
});
test("legacy and insecure stores report value-free status and require explicit reset", async () => {
	const { path, service } = await setup();
	await service.update({ givenName: "Synthetic" });
	await writeFile(path, JSON.stringify({ givenName: "Synthetic" }), { mode: 0o600 });
	expect(await service.status()).toMatchObject({
		status: "invalid",
		reason: "unsupported_format",
		remedy: "xcsh profile reset person --yes",
	});
	await import("node:fs/promises").then(fs => fs.chmod(path, 0o644));
	expect(await service.status()).toMatchObject({ status: "invalid", reason: "insecure_permissions" });
	expect(await service.reset()).toBe(true);
	expect(await service.reset()).toBe(false);
	expect(await service.status()).toMatchObject({ status: "missing" });
	expect(await Bun.file(path).exists()).toBe(false);
	expect((await stat(join(path, ".."))).isDirectory()).toBe(true);
	await import("node:fs/promises").then(fs => fs.chmod(join(path, ".."), 0o755));
	expect(await service.status()).toMatchObject({ status: "invalid", reason: "insecure_permissions" });
	expect(await service.reset()).toBe(false);
	expect((await stat(join(path, ".."))).mode & 0o777).toBe(0o700);
});
test("reset refuses symlinks and reports a busy active lock", async () => {
	const first = await setup();
	await mkdir(join(first.path, ".."), { recursive: true });
	await symlink(join(first.path, "missing-target"), first.path);
	await expect(first.service.reset()).rejects.toThrow("invalid_shape");
	expect((await lstat(first.path)).isSymbolicLink()).toBe(true);

	const second = await setup();
	await mkdir(join(second.path, ".."), { recursive: true });
	await mkdir(`${second.path}.lock`);
	await expect(new PersonProfileService(second.path, 25).reset()).rejects.toThrow("lock_busy");
});
test("multi-profile reset acquires every lock before deleting either target", async () => {
	const dir = await mkdtemp(join(tmpdir(), "profile-reset-all-"));
	dirs.push(dir);
	const personPath = join(dir, "a-person.json");
	const computerPath = join(dir, "z-computer.json");
	const person = new PersonProfileService(personPath, 25);
	const computer = new MachineProfileService(computerPath, async () => ({ name: "Synthetic computer" }), 25);
	await person.update({ givenName: "Person-A" });
	await computer.refresh();
	await mkdir(`${computerPath}.lock`);

	await expect(resetProfileTargets([person, computer])).rejects.toThrow("lock_busy");
	expect(await Bun.file(personPath).exists()).toBe(true);
	expect(await Bun.file(computerPath).exists()).toBe(true);
	expect(await Bun.file(`${personPath}.lock`).exists()).toBe(false);

	await rm(`${computerPath}.lock`, { recursive: true });
	await rm(computerPath);
	await symlink(join(dir, "missing-computer"), computerPath);
	await expect(resetProfileTargets([person, computer])).rejects.toThrow("invalid_shape");
	expect(await Bun.file(personPath).exists()).toBe(true);
	expect((await lstat(computerPath)).isSymbolicLink()).toBe(true);
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
	expect(refreshed.collectors).toEqual([expect.objectContaining({ id: "broken", status: "error" })]);
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

test("fresh profiles discover available sources automatically and configuration can disable discovery", async () => {
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
	expect(calls).toBe(1);
	await service.refresh([], (await service.get()).revision, undefined, true);
	await service.reconcileFromCollectors();
	expect(calls).toBe(1);
	await service.refresh(["configured"], (await service.get()).revision, undefined, true);
	const profile = await service.get();
	await service.update({ jobTitle: "Corrected engineer" }, profile.revision);
	await service.reconcileFromCollectors();
	expect((await service.get()).facts.jobTitle).toBe("Corrected engineer");
});

test("independent collectors run concurrently before declared dependents", async () => {
	const { service } = await setup();
	const events: string[] = [];
	for (const [id, field] of [
		["first", "givenName"],
		["second", "jobTitle"],
	] as const)
		service.registerProfileCollector({
			id,
			name: id,
			available: async () => true,
			collect: async () => {
				events.push(`${id}:start`);
				await Bun.sleep(20);
				events.push(`${id}:end`);
				return { [field]: `Synthetic ${id}` };
			},
		});
	service.registerProfileCollector({
		id: "dependent",
		name: "dependent",
		dependsOn: ["first"],
		available: async () => true,
		collect: async () => {
			events.push("dependent");
			expect((await service.get()).facts.givenName).toBe("Synthetic first");
			return {};
		},
	});
	await service.reconcileFromCollectors();
	expect(events.indexOf("second:start")).toBeLessThan(events.indexOf("first:end"));
	expect(events.at(-1)).toBe("dependent");
});

test("conflicting collected evidence is retained as observation without replacing the person", async () => {
	const { service } = await setup();
	await service.update({ email: "human@example.com" });
	service.registerProfileCollector({
		id: "account",
		name: "Account",
		available: async () => true,
		collect: async () => ({ email: "account@example.com" }),
	});
	await service.refresh(["account"]);
	const profile = await service.get();
	expect(profile.facts.email).toBe("human@example.com");
	expect(profile.observations).toContainEqual(
		expect.objectContaining({
			field: "email",
			value: "account@example.com",
			source: "account",
			kind: "observed",
		}),
	);
	await service.forget(["email"]);
	await service.refresh(["account"]);
	expect(JSON.stringify(await service.get())).not.toContain("@example.com");
});

test("switching a collector account cannot silently replace the human", async () => {
	const { service } = await setup();
	let account = "example-account-a";
	service.registerProfileCollector({
		id: "identity",
		name: "Identity",
		available: async () => true,
		collect: async () => ({ givenName: account, identifiers: { github: account } }),
	});
	await service.refresh(["identity"]);
	account = "example-account-b";
	await service.refresh(["identity"]);
	const profile = await service.get();
	expect(profile.facts.givenName).toBe("example-account-a");
	expect(profile.observations).toContainEqual(
		expect.objectContaining({ field: "givenName", value: "example-account-b", kind: "observed" }),
	);
});

test("forgetting email also suppresses email-bearing account evidence", async () => {
	const { service } = await setup();
	service.registerProfileCollector({
		id: "mail_account",
		name: "Mail account",
		available: async () => true,
		collect: async () => ({
			facts: {},
			observations: [
				{
					field: "accounts",
					value: [{ provider: "synthetic", identifier: "synthetic@example.com", principalType: "user" }],
					source: "mail_account",
					kind: "observed",
					observedAt: new Date().toISOString(),
				},
			],
		}),
	});
	await service.refresh(["mail_account"]);
	await service.forget(["email"]);
	await service.refresh(["mail_account"]);
	expect(JSON.stringify(await service.get())).not.toContain("synthetic@example.com");
});

test("structured personal attributes accumulate and can be corrected or forgotten individually", async () => {
	const { service } = await setup();
	await service.update({ additionalProperty: [{ propertyID: "favorite_color", value: "green" }] });
	await service.update({
		additionalProperty: [{ propertyID: "preferred_editor", value: "synthetic-editor" }],
	});
	await service.update({ additionalProperty: [{ propertyID: "favorite_color", value: "blue" }] });
	const before = await service.get();
	expect(before.facts).toHaveProperty("additionalProperty", [
		{ propertyID: "favorite_color", value: "blue" },
		{ propertyID: "preferred_editor", value: "synthetic-editor" },
	]);
	await service.forget([], undefined, undefined, undefined, ["favorite_color"]);
	const after = await service.get();
	expect(JSON.stringify(after)).not.toContain('"blue"');
	expect(JSON.stringify(after)).toContain("synthetic-editor");
	expect(after).toHaveProperty("suppressedProperties.favorite_color");
});

test("personal attribute observations keep distinct keys and forgetting suppresses their return", async () => {
	const { service } = await setup();
	const observe = (propertyID: string, value: string) =>
		service.observe([
			{
				field: "additionalProperty",
				value: [{ propertyID, value }],
				source: "synthetic",
				kind: "observed",
				observedAt: new Date().toISOString(),
			},
		]);
	await observe("favorite_color", "green");
	await observe("preferred_editor", "synthetic-editor");
	expect((await service.get()).observations).toHaveLength(2);
	await service.forget([], undefined, undefined, undefined, ["favorite_color"]);
	await observe("favorite_color", "green");
	const after = await service.get();
	expect(after.observations).toHaveLength(1);
	expect(JSON.stringify(after)).not.toContain('"green"');
});

test("unregister is scoped to its extension and source discovery is programmatic", async () => {
	const { service } = await setup();
	service.registerProfileCollector(
		{ id: "custom", name: "Custom", available: async () => true, collect: async () => ({}) },
		"owner",
	);
	expect(service.listCollectors()).toEqual([{ id: "custom", name: "Custom" }]);
	expect(service.unregisterProfileCollector("custom", "other")).toBe(false);
	expect(service.unregisterProfileCollector("custom", "owner")).toBe(true);
	expect(service.listCollectors()).toEqual([]);
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
		collect: async () => {
			await Bun.sleep(10);
			return { jobTitle: "First title" };
		},
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
test("unchanged collector facts and health do not churn the profile revision", async () => {
	const { service } = await setup();
	let available = true;
	service.registerProfileCollector({
		id: "stable",
		name: "Stable",
		available: async () => available,
		collect: async () => ({ givenName: "Synthetic" }),
	});
	const first = await service.refresh(["stable"]);
	const firstAttempt = first.collectionState?.stable?.attemptedAt;
	await Bun.sleep(2);
	const second = await service.refresh(["stable"]);
	expect(second.revision).toBe(first.revision);
	expect(Date.parse(second.collectionState?.stable?.attemptedAt ?? "")).toBeGreaterThanOrEqual(
		Date.parse(firstAttempt ?? ""),
	);
	available = false;
	const unavailable = await service.refresh(["stable"]);
	expect(unavailable.revision).toBe(first.revision + 1);
	expect(unavailable.collectionState?.stable?.status).toBe("unavailable");
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
	await expect(service.get()).rejects.toThrow("invalid_shape");
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

test("personal attribute ownership protects corrections while other source attributes refresh", async () => {
	const { service } = await setup();
	let color = "green";
	service.registerProfileCollector({
		id: "attributes",
		name: "Synthetic attributes",
		available: async () => true,
		collect: async () => ({
			additionalProperty: [
				{ propertyID: "favorite_color", value: color },
				{ propertyID: "preferred_editor", value: "synthetic-editor" },
			],
		}),
	});
	await service.refresh(["attributes"]);
	await service.update({ additionalProperty: [{ propertyID: "favorite_color", value: "blue" }] });
	const corrected = await service.get();
	const repeated = await service.update({ additionalProperty: [{ propertyID: "favorite_color", value: "blue" }] });
	expect(repeated.revision).toBe(corrected.revision);
	color = "red";
	await service.refresh(["attributes"]);
	const refreshed = await service.get();
	expect(refreshed.facts.additionalProperty?.find(p => p.propertyID === "favorite_color")?.value).toBe("blue");
	expect(refreshed.propertyProvenance?.favorite_color.owner).toBe("user");
	expect(refreshed.propertyProvenance?.preferred_editor.owner).toBe("attributes");
	expect(refreshed.observations.some(o => o.field === "additionalProperty")).toBe(true);
	await service.forget([], undefined, undefined, undefined, ["favorite_color"]);
	await service.refresh(["attributes"]);
	expect((await service.get()).facts.additionalProperty).toEqual([
		{ propertyID: "preferred_editor", value: "synthetic-editor" },
	]);
});
