import { beforeAll, expect, test, vi } from "bun:test";
import type { Component } from "@f5-sales-demo/pi-tui";
import {
	SSHCommandController,
	type SSHCommandDependencies,
} from "../../../src/modes/controllers/ssh-command-controller";
import { getThemeByName, setThemeInstance } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";
import type { SSHConfigFile, SSHHostConfig } from "../../../src/ssh/config-writer";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));

function harness(inputs: string[][], initial: Record<string, SSHConfigFile> = {}) {
	const files = new Map(Object.entries(structuredClone(initial)));
	const writes: string[] = [];
	const failures = { add: 0, remove: 0 };
	const screens: string[] = [];
	let current: Component | undefined;
	const dependencies: SSHCommandDependencies = {
		projectDir: () => "/fixture/project",
		configPath: (scope, cwd) => (scope === "user" ? "/fixture/agent/ssh.json" : `${cwd}/.xcsh/ssh.json`),
		readConfig: async path => structuredClone(files.get(path) ?? { hosts: {} }),
		addHost: async (path, name, config) => {
			if (failures.add-- > 0) throw new Error("synthetic SSH config write failure");
			const existing = structuredClone(files.get(path) ?? { hosts: {} });
			if (existing.hosts?.[name]) throw new Error(`Host "${name}" already exists`);
			existing.hosts = { ...existing.hosts, [name]: structuredClone(config) };
			files.set(path, existing);
			writes.push(`add:${path}:${name}`);
		},
		removeHost: async (path, name) => {
			if (failures.remove-- > 0) throw new Error("synthetic SSH config write failure");
			const existing = structuredClone(files.get(path) ?? { hosts: {} });
			if (!existing.hosts?.[name]) throw new Error(`Host "${name}" not found`);
			delete existing.hosts[name];
			files.set(path, existing);
			writes.push(`remove:${path}:${name}`);
		},
		loadHosts: async () => ({ items: [], all: [], warnings: [], providers: [] }),
	};
	const ctx = {
		showStatus: vi.fn(),
		showError: vi.fn(),
		showHookCustom: (
			factory: (ui: unknown, theme: unknown, keys: unknown, done: (result: unknown) => void) => Component,
		) =>
			new Promise(resolve => {
				current = factory({ terminal: { rows: 24 }, requestRender() {} }, {}, {}, resolve);
				screens.push(Bun.stripANSI(current.render(80).join("\n")));
				for (const input of inputs.shift() ?? []) current.handleInput?.(input);
			}),
	} as unknown as InteractiveModeContext;
	return {
		ctx,
		files,
		failures,
		writes,
		screens,
		controller: new SSHCommandController(ctx, dependencies),
		input: (value: string) => current?.handleInput?.(value),
		text: () => Bun.stripANSI(current?.render(80).join("\n") ?? ""),
	};
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Expected SSH review state was not rendered");
}

test("SSH add is Cancel-first and separates saved configuration from connectivity", async () => {
	const h = harness([["\r"]]);
	await h.controller.handle('/ssh add edge --host edge.invalid --user demo --port 2222 --key "/keys/demo key"');
	expect(h.writes).toEqual([]);
	expect(h.screens[0]).toContain("Review SSH host addition");
	expect(h.screens[0]).toContain("ssh-host:project:edge");
	expect(h.screens[0]).toContain("Absent → demo@edge.invalid · port 2222 · key /keys/demo key");
	expect(h.screens[0]).toContain("configuration only; it does not test connectivity");
	expect(h.screens[0]).toContain("remote connection");
});

test("confirmed SSH add writes the exact reviewed scope and values", async () => {
	const h = harness([["\x1b[B", "\r"]]);
	await h.controller.handle("/ssh add edge --host edge.invalid --compat --scope user");
	expect(h.writes).toEqual(["add:/fixture/agent/ssh.json:edge"]);
	expect(h.files.get("/fixture/agent/ssh.json")?.hosts?.edge).toEqual({ host: "edge.invalid", compat: true });
	expect(h.ctx.showStatus).toHaveBeenCalledWith(
		'Saved SSH host "edge" in user configuration. Connectivity was not tested.',
	);
});

test("SSH add renews a stale review before writing", async () => {
	const h = harness([]);
	const pending = h.controller.handle("/ssh add edge --host edge.invalid");
	await waitFor(() => h.screens.length === 1);
	h.files.set("/fixture/project/.xcsh/ssh.json", { hosts: { other: { host: "other.invalid" } } });
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("proposal changed"));
	expect(h.writes).toEqual([]);
	expect(h.text()).toContain("Cancel");
	h.input("\r");
	await pending;
	expect(h.files.get("/fixture/project/.xcsh/ssh.json")?.hosts?.edge).toBeUndefined();
});

test("SSH add keeps a failed write unresolved and retries the exact reviewed target", async () => {
	const h = harness([]);
	h.failures.add = 1;
	const pending = h.controller.handle("/ssh add edge --host edge.invalid --scope project");
	await waitFor(() => h.screens.length === 1);
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("synthetic SSH config write failure"));
	expect(h.writes).toEqual([]);
	expect(h.text()).toContain("Retry change");
	h.input("\x1b[B");
	h.input("\r");
	await pending;
	expect(h.writes).toEqual(["add:/fixture/project/.xcsh/ssh.json:edge"]);
	expect(h.files.get("/fixture/project/.xcsh/ssh.json")?.hosts?.edge).toEqual({ host: "edge.invalid" });
});

test("SSH remove reviews the exact existing target and cancellation preserves it", async () => {
	const path = "/fixture/project/.xcsh/ssh.json";
	const original: SSHHostConfig = { host: "edge.invalid", username: "demo", port: 2200 };
	const h = harness([["\r"]], { [path]: { hosts: { edge: original } } });
	await h.controller.handle("/ssh remove edge --scope project");
	expect(h.writes).toEqual([]);
	expect(h.files.get(path)?.hosts?.edge).toEqual(original);
	expect(h.screens[0]).toContain("demo@edge.invalid · port 2200");
	expect(h.screens[0]).toContain("Existing processes or connections are not terminated");
});

test("SSH remove renews a stale proposal and never deletes a replacement host", async () => {
	const path = "/fixture/project/.xcsh/ssh.json";
	const h = harness([], { [path]: { hosts: { edge: { host: "edge.invalid" } } } });
	const pending = h.controller.handle("/ssh remove edge --scope project");
	await waitFor(() => h.screens.length === 1);
	h.files.set(path, { hosts: { edge: { host: "replacement.invalid", username: "other" } } });
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("proposal changed"));
	expect(h.writes).toEqual([]);
	expect(h.files.get(path)?.hosts?.edge).toEqual({ host: "replacement.invalid", username: "other" });
	h.input("\r");
	await pending;
});

test("SSH list and help use bounded shared reports", async () => {
	const path = "/fixture/project/.xcsh/ssh.json";
	const h = harness([["\x1b"], ["\x1b"]], { [path]: { hosts: { edge: { host: "edge.invalid" } } } });
	await h.controller.handle("/ssh list");
	await h.controller.handle("/ssh help");
	expect(h.screens[0]).toContain("Saved scope, source, and connection target");
	expect(h.screens[0]).toContain("edge.invalid");
	expect(h.screens[1]).toContain("Commands and saved-configuration behavior");
	expect(h.screens[1]).toContain("Esc: close");
});
