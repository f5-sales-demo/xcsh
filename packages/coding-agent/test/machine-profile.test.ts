import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MachineProfileService } from "../src/person-profile/machine-profile";

const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
async function setup() {
	const dir = await mkdtemp(join(tmpdir(), "machine-profile-"));
	dirs.push(dir);
	const path = join(dir, "private", "computer-profile.json");
	let calls = 0;
	const service = new MachineProfileService(path, async () => {
		calls++;
		return { platform: "synthetic", hostname: "synthetic-device", cpuLogicalCores: 4 };
	});
	return { path, service, calls: () => calls };
}
test("machine reads are side-effect free and refresh persists a separate validated device", async () => {
	const { path, service, calls } = await setup();
	expect((await service.get()).state).toBe("empty");
	expect(await Bun.file(path).exists()).toBe(false);
	await service.refresh();
	await service.refresh(undefined, 60000);
	expect(calls()).toBe(1);
	const saved = await new MachineProfileService(path).get();
	expect(saved.facts.hostname).toBe("synthetic-device");
	expect(saved.facts["@type"]).toBe("IndividualProduct");
	expect((await stat(path)).mode & 0o777).toBe(0o600);
});
test("malformed machine files remain intact and cancellation does not save", async () => {
	const { path, service } = await setup();
	const abort = new AbortController();
	abort.abort();
	await expect(service.refresh(abort.signal)).rejects.toThrow();
	expect(await Bun.file(path).exists()).toBe(false);
	await service.refresh();
	await writeFile(path, "synthetic-invalid");
	await expect(service.get()).rejects.toThrow();
	expect(await readFile(path, "utf8")).toBe("synthetic-invalid");
});

test("obsolete machine storage is rejected and can be reset without a backup", async () => {
	const { path, service } = await setup();
	await service.refresh();
	await writeFile(path, JSON.stringify({ hostname: "synthetic-machine" }), { mode: 0o600 });
	expect(await service.status()).toMatchObject({
		status: "invalid",
		reason: "unsupported_format",
		remedy: "xcsh profile reset computer --yes",
	});
	expect(await service.reset()).toBe(true);
	expect(await service.status()).toMatchObject({ status: "missing" });
	expect((await import("node:fs/promises")).readdir(join(path, ".."))).resolves.toEqual([]);
});
test("machine tool reads in Plan and blocks refresh through the same permission guard", async () => {
	const { service, calls } = await setup();
	const { MachineProfileTool } = await import("../src/tools/machine-profile");
	const tool = new MachineProfileTool({
		cwd: "/tmp",
		settings: { get: () => false },
		machineProfileService: service,
		getPlanModeState: () => ({ enabled: true, planFilePath: "/tmp/plan.md" }),
	} as never);
	const result = await tool.execute("read", { action: "get" });
	expect(result.details).toHaveProperty("state", "empty");
	await expect(tool.execute("write", { action: "refresh" })).rejects.toThrow("Plan mode");
	expect(calls()).toBe(0);
});

test("machine Ask approval respects decline, cancellation, late approval and Plan transitions", async () => {
	const { service, calls } = await setup();
	const { MachineProfileTool } = await import("../src/tools/machine-profile");
	const { applyRemotePermissionProfile } = await import("../src/sandbox/remote-permissions");
	const settings = { get: () => false, override: () => {} };
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
	let plan = false;
	const tool = new MachineProfileTool({
		cwd: "/tmp",
		settings,
		machineProfileService: service,
		getPlanModeState: () => ({ enabled: plan, planFilePath: "/tmp/plan.md" }),
	} as never);
	const args = { action: "refresh" as const };
	await expect(tool.execute("missing", args)).rejects.toThrow("approval unavailable");
	await expect(
		tool.execute("decline", args, undefined, undefined, {
			hasUI: true,
			ui: { select: async () => "Decline" },
		} as never),
	).rejects.toThrow("declined");
	const abort = new AbortController();
	await expect(
		tool.execute("late", args, abort.signal, undefined, {
			hasUI: true,
			ui: {
				select: async () => {
					abort.abort();
					return "Allow once";
				},
			},
		} as never),
	).rejects.toThrow("cancelled");
	await expect(
		tool.execute("plan", args, undefined, undefined, {
			hasUI: true,
			ui: {
				select: async () => {
					plan = true;
					return "Allow once";
				},
			},
		} as never),
	).rejects.toThrow("Plan mode");
	expect(calls()).toBe(0);
	plan = false;
	await tool.execute("allow", args, undefined, undefined, {
		hasUI: true,
		ui: { select: async () => "Allow once" },
	} as never);
	expect(calls()).toBe(1);
});
