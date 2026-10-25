import { expect, spyOn, test } from "bun:test";
import { Settings } from "../src/config/settings";
import { applyRemotePermissionProfile } from "../src/sandbox/remote-permissions";
import { runWithContextExecution } from "../src/services/context-execution";
import { PluginWorkflowService } from "../src/services/plugin-workflow";
import { BUILTIN_TOOLS } from "../src/tools";

const candidate = {
	plugin: "kvm",
	marketplace: "qualification",
	scope: "project",
	fingerprint: "approved-source",
	dependencyPlan: [{ pluginId: "kvm@qualification", version: "3.2.13", scope: "project", dependency: false }],
	changes: [{ pluginId: "kvm@qualification", action: "install" }],
};

async function fixture(changes = candidate.changes) {
	let installs = 0;
	let approvals = 0;
	let reloads = 0;
	let fingerprint = candidate.fingerprint;
	const service = {
		catalogs: async () => [{ name: "qualification" }],
		list: async () => [],
		plan: async () => ({ ...candidate, changes, fingerprint }),
		install: async () => {
			installs++;
			return { state: "installed", changed: true };
		},
	};
	const factory = BUILTIN_TOOLS.xcsh_plugin;
	expect(factory).toBeDefined();
	const settings = Settings.isolated({});
	applyRemotePermissionProfile(settings, {
		approvalPolicy: "on-request",
		approvalsReviewer: "user",
		activePermissionProfile: { id: ":workspace" },
		sandboxPolicy: {
			type: "workspaceWrite",
			writableRoots: [],
			networkAccess: false,
			excludeTmpdirEnvVar: false,
			excludeSlashTmp: false,
		},
	});
	const tool = await factory({
		cwd: "/tmp/owned-plugin-project",
		settings,
		getPluginWorkflowService: async () => service,
		reloadPluginTools: async () => {
			reloads++;
		},
	} as any);
	expect(tool).toBeDefined();
	return {
		tool: tool!,
		service,
		get reloads() {
			return reloads;
		},
		settings,
		get installs() {
			return installs;
		},
		get approvals() {
			return approvals;
		},
		changeSource() {
			fingerprint = "changed-after-review";
		},
		context(answer: string | undefined = "Allow once", beforeAnswer?: () => void) {
			return {
				hasUI: true,
				ui: {
					select: async () => {
						approvals++;
						beforeAnswer?.();
						return answer;
					},
				},
			} as any;
		},
	};
}

test("plugin inspection and planning use typed operations without approvals", async () => {
	const f = await fixture();
	for (const action of ["catalogs", "list", "plan"]) {
		await f.tool.execute(
			"read-only",
			{ action, plugin: "kvm", marketplace: "qualification" },
			undefined,
			undefined,
			f.context(),
		);
	}
	expect(f.approvals).toBe(0);
	expect(f.installs).toBe(0);
});

test("unchanged installed plugin is a no-op without a confirmation or installer", async () => {
	const f = await fixture([]);
	const result = await f.tool.execute(
		"repeat",
		{ action: "install", plugin: "kvm", marketplace: "qualification" },
		undefined,
		undefined,
		f.context(),
	);
	expect(result.details).toMatchObject({ state: "already-installed", changed: false });
	expect(f.reloads).toBe(0);
	expect(f.approvals).toBe(0);
	expect(f.installs).toBe(0);
});

test("one actual installation receives one review and executes once", async () => {
	const f = await fixture();
	await f.tool.execute(
		"install",
		{ action: "install", plugin: "kvm", marketplace: "qualification" },
		undefined,
		undefined,
		f.context(),
	);
	expect(f.approvals).toBe(1);
	expect(f.installs).toBe(1);
	expect(f.reloads).toBe(1);
});

test("declined installation never executes", async () => {
	const f = await fixture();
	await expect(
		f.tool.execute(
			"decline",
			{ action: "install", plugin: "kvm", marketplace: "qualification" },
			undefined,
			undefined,
			f.context("Decline"),
		),
	).rejects.toThrow("declined");
	expect(f.approvals).toBe(1);
	expect(f.installs).toBe(0);
});

test("source changes after approval invalidate the reviewed installation", async () => {
	const f = await fixture();
	await expect(
		f.tool.execute(
			"drift",
			{ action: "install", plugin: "kvm", marketplace: "qualification" },
			undefined,
			undefined,
			f.context("Allow once", () => f.changeSource()),
		),
	).rejects.toThrow("changed");
	expect(f.installs).toBe(0);
});

test("CLI-only context flags are rejected before approval", async () => {
	const f = await fixture();
	await expect(
		f.tool.execute(
			"invalid",
			{ action: "install", plugin: "kvm", marketplace: "qualification", context: "sales-demo" },
			undefined,
			undefined,
			f.context(),
		),
	).rejects.toThrow("Invalid plugin operation");
	expect(f.approvals).toBe(0);
	expect(f.installs).toBe(0);
});

test("native plugin operations use the admitted turn environment without exposing it", async () => {
	const settings = Settings.isolated({});
	settings.override("bash.environment", { XCSH_NAMESPACE: "later-selection" });
	let observed: Readonly<Record<string, string>> | undefined;
	const factory = spyOn(PluginWorkflowService, "create").mockImplementation(async (_cwd, environment) => {
		observed = environment;
		return { catalogs: async () => [{ name: "qualification" }] } as any;
	});
	try {
		const tool = await BUILTIN_TOOLS.xcsh_plugin({ cwd: "/tmp/owned-plugin-project", settings } as any);
		const result = await runWithContextExecution(
			{
				environment: { XCSH_NAMESPACE: "admitted-selection", XCSH_API_TOKEN: "synthetic-private-value" },
				sensitiveKeys: ["XCSH_API_TOKEN"],
				source: "local",
			},
			() => tool!.execute("admitted", { action: "catalogs" }),
		);
		expect(observed).toEqual({ XCSH_NAMESPACE: "admitted-selection", XCSH_API_TOKEN: "synthetic-private-value" });
		expect(JSON.stringify(result)).not.toContain("synthetic-private-value");
	} finally {
		factory.mockRestore();
	}
});

test("project catalog preference resolves an omitted marketplace before planning", async () => {
	const f = await fixture();
	f.settings.override("marketplace.preferredCatalog", "qualification");
	let selected: string | undefined;
	const original = f.service.plan;
	f.service.plan = async (...args: any[]) => {
		selected = args[1];
		return original();
	};
	await f.tool.execute("preferred", { action: "plan", plugin: "kvm" }, undefined, undefined, f.context());
	expect(selected).toBe("qualification");
	expect(f.approvals).toBe(0);
});

test("conflicting marketplace is rejected before installation approval", async () => {
	const f = await fixture();
	f.settings.override("marketplace.preferredCatalog", "qualification");
	await expect(
		f.tool.execute(
			"wrong-catalog",
			{ action: "install", plugin: "kvm", marketplace: "public" },
			undefined,
			undefined,
			f.context(),
		),
	).rejects.toThrow("configured catalog");
	expect(f.approvals).toBe(0);
	expect(f.installs).toBe(0);
});
