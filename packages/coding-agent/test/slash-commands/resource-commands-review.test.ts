import { afterEach, beforeAll, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Component } from "@f5-sales-demo/pi-tui";
import { _resetSettingsForTest, Settings } from "../../src/config/settings";
import { getThemeByName, setThemeInstance } from "../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../src/modes/types";
import { ContextService } from "../../src/services/xcsh-context";
import { handleExportResourceCommand } from "../../src/slash-commands/export-command";
import { handleResourceCommand } from "../../src/slash-commands/resource-commands";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));

const originalFetch = globalThis.fetch;
const tempRoots: string[] = [];

afterEach(async () => {
	globalThis.fetch = originalFetch;
	ContextService._resetForTest();
	_resetSettingsForTest();
	for (const root of tempRoots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function fixture(responses: string[][], getResult: "missing" | "present" = "missing") {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-resource-review-"));
	tempRoots.push(root);
	const methods: string[] = [];
	globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
		const method = init?.method ?? "GET";
		methods.push(method);
		if (method === "POST")
			return new Response(JSON.stringify({ metadata: { name: "reviewed-lb", namespace: "demo" }, spec: {} }), {
				status: 200,
			});
		if (getResult === "present")
			return new Response(
				JSON.stringify({
					metadata: { name: "reviewed-lb", namespace: "demo", system_metadata: { uid: "discarded" } },
					spec: { domains: ["reviewed.invalid"], routes: [], origin_pools: [] },
				}),
				{ status: 200 },
			);
		return new Response(JSON.stringify({ code: 5, message: "not found" }), { status: 404 });
	}) as typeof fetch;
	await Settings.init({ inMemory: true, cwd: root, agentDir: root });
	const service = ContextService.init(root);
	await service.createContext({
		name: "fixture",
		apiUrl: "https://fixture.invalid",
		apiToken: "secret-token-never-rendered",
		defaultNamespace: "demo",
	});
	await service.activate("fixture");
	const manifest = path.join(root, "resource.yaml");
	await fs.writeFile(
		manifest,
		[
			"kind: http_loadbalancer",
			"metadata:",
			"  name: reviewed-lb",
			"  namespace: demo",
			"spec:",
			"  domains:",
			"    - reviewed.invalid",
			"  routes: []",
			"  origin_pools: []",
		].join("\n"),
	);
	const screens: string[] = [];
	const statuses: string[] = [];
	const errors: string[] = [];
	let current: Component | undefined;
	const ctx = {
		editor: { addToHistory() {}, setText() {} },
		showStatus: (message: string) => statuses.push(Bun.stripANSI(message)),
		showError: (message: string) => errors.push(Bun.stripANSI(message)),
		showHookCustom: (
			factory: (ui: unknown, theme: unknown, keys: unknown, done: (result: unknown) => void) => Component,
		) =>
			new Promise(resolve => {
				current = factory({ terminal: { rows: 24 }, requestRender() {} }, {}, {}, resolve);
				screens.push(Bun.stripANSI(current.render(80).join("\n")));
				for (const input of responses.shift() ?? []) current.handleInput?.(input);
			}),
	} as unknown as InteractiveModeContext;
	return {
		root,
		manifest,
		methods,
		screens,
		statuses,
		errors,
		ctx,
		input: (data: string) => current?.handleInput?.(data),
		text: () => Bun.stripANSI(current?.render(80).join("\n") ?? ""),
	};
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 2_000; attempt++) {
		if (predicate()) return;
		await Bun.sleep(2);
	}
	throw new Error("Timed out waiting for reviewed resource state");
}

test("resource create is Cancel-first and performs no remote write before review", async () => {
	const h = await fixture([["\r"]]);
	await handleResourceCommand(
		"create",
		{ name: "create", args: `-f ${h.manifest}`, text: `/create -f ${h.manifest}` },
		h.ctx,
	);
	expect(h.methods).not.toContain("POST");
	expect(h.screens[0]).toContain("Review resource create");
	expect(h.screens[0]).toContain("http_loadbalancer/reviewed-lb · namespace demo");
	expect(h.screens[0]).toContain("Absent → Desired manifest");
	expect(h.screens[0]).toContain("SHA256");
	expect(h.screens[0]).not.toContain("secret-token-never-rendered");
});

test("confirmed resource create revalidates then reports the observed backing write", async () => {
	const h = await fixture([["\x1b[B", "\r"], ["\x1b"]]);
	await handleResourceCommand(
		"create",
		{ name: "create", args: `-f ${h.manifest}`, text: `/create -f ${h.manifest}` },
		h.ctx,
	);
	expect(h.methods.filter(method => method === "POST")).toHaveLength(1);
	expect(h.methods.filter(method => method === "GET").length).toBeGreaterThanOrEqual(2);
	expect(h.screens.at(-1)).toContain("Resource create complete");
	expect(h.screens.at(-1)).toContain("1 succeeded, 0 failed, 1 total");
});

test("manifest file export reviews overwrite effects and cancellation leaves the destination absent", async () => {
	const h = await fixture([["\r"]], "present");
	const destination = path.join(h.root, "exports", "lb.yaml");
	await handleExportResourceCommand(
		{
			name: "manifest",
			args: `http_loadbalancer reviewed-lb -n demo -o yaml -f ${destination}`,
			text: `/manifest http_loadbalancer reviewed-lb -n demo -o yaml -f ${destination}`,
		},
		h.ctx,
	);
	expect(await fs.stat(destination).catch(() => undefined)).toBeUndefined();
	expect(h.screens[0]).toContain("Review manifest file export");
	expect(h.screens[0]).toContain(`${destination}: Absent`);
	expect(h.screens[0]).toContain("Existing changed files are atomically replaced");
});

test("confirmed manifest file export revalidates and atomically persists the observed content", async () => {
	const h = await fixture([["\x1b[B", "\r"], ["\x1b"]], "present");
	const destination = path.join(h.root, "exports", "lb.yaml");
	await handleExportResourceCommand(
		{
			name: "manifest",
			args: `http_loadbalancer reviewed-lb -n demo -o yaml -f ${destination}`,
			text: `/manifest http_loadbalancer reviewed-lb -n demo -o yaml -f ${destination}`,
		},
		h.ctx,
	);
	const content = await fs.readFile(destination, "utf8");
	expect(content).toContain("kind: http_loadbalancer");
	expect(content).toContain("name: reviewed-lb");
	expect(h.screens.at(-1)).toContain("Manifest export complete");
	expect(h.screens.at(-1)).toContain(`${destination}: written`);
});

test("resource apply client dry-run produces a report without any remote mutation", async () => {
	const h = await fixture([["\x1b"]]);
	await handleResourceCommand(
		"apply",
		{ name: "apply", args: `-f ${h.manifest} --dry-run=client`, text: `/apply -f ${h.manifest} --dry-run=client` },
		h.ctx,
	);
	expect(h.methods.every(method => method === "GET")).toBe(true);
	expect(h.screens[0]).toContain("Resource apply dry run");
	expect(h.screens[0]).toContain("no remote resources were changed");
});

test("confirmed resource apply updates an existing target only after its fresh review", async () => {
	const h = await fixture([["\x1b[B", "\r"], ["\x1b"]], "present");
	globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
		const method = init?.method ?? "GET";
		h.methods.push(method);
		return new Response(
			JSON.stringify({
				metadata: { name: "reviewed-lb", namespace: "demo" },
				spec: { domains: method === "PUT" ? ["reviewed.invalid"] : ["old.invalid"], routes: [], origin_pools: [] },
			}),
			{ status: 200 },
		);
	}) as typeof fetch;
	await handleResourceCommand(
		"apply",
		{ name: "apply", args: `-f ${h.manifest}`, text: `/apply -f ${h.manifest}` },
		h.ctx,
	);
	expect(h.methods.filter(method => method === "PUT")).toHaveLength(1);
	expect(h.screens[0]).toContain("Review resource apply");
	expect(h.screens.at(-1)).toContain("Resource apply complete");
});

test("describe, get, diff, empty, and failure states retain bounded readable outcomes", async () => {
	const reports = await fixture([["\x1b"], ["\x1b"], ["\x1b"]], "present");
	await handleResourceCommand(
		"describe",
		{ name: "describe", args: "http_loadbalancer reviewed-lb -n demo", text: "/describe" },
		reports.ctx,
	);
	await handleResourceCommand(
		"get",
		{ name: "get", args: "http_loadbalancer reviewed-lb -n demo", text: "/get" },
		reports.ctx,
	);
	await handleResourceCommand("diff", { name: "diff", args: `-f ${reports.manifest}`, text: "/diff" }, reports.ctx);
	expect(reports.screens[0]).toContain("Resolved remote resource · namespace demo");
	expect(reports.screens[1]).toContain("http_loadbalancer/reviewed-lb");
	expect(reports.screens[2]).toContain("Resource differences");

	const empty = await fixture([["\x1b"]]);
	globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
		empty.methods.push(init?.method ?? "GET");
		return new Response(JSON.stringify({ items: [] }), { status: 200 });
	}) as typeof fetch;
	await handleResourceCommand("get", { name: "get", args: "http_loadbalancer -n demo", text: "/get" }, empty.ctx);
	expect(empty.screens[0]).toContain("http_loadbalancer resources");
	expect(empty.screens[0]).toMatch(/No .* resources found/i);

	const failed = await fixture([]);
	globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
		failed.methods.push(init?.method ?? "GET");
		return new Response(JSON.stringify({ message: "synthetic remote failure" }), { status: 500 });
	}) as typeof fetch;
	await handleResourceCommand(
		"get",
		{ name: "get", args: "http_loadbalancer reviewed-lb -n demo", text: "/get" },
		failed.ctx,
	);
	expect(failed.errors).toHaveLength(1);
	expect(failed.errors[0]).toContain("synthetic remote failure");
});

test("resource delete is Cancel-first and confirmed deletion uses the exact reviewed identity", async () => {
	const cancelled = await fixture([["\r"]], "present");
	await handleResourceCommand(
		"delete",
		{ name: "delete", args: "http_loadbalancer reviewed-lb -n demo", text: "/delete" },
		cancelled.ctx,
	);
	expect(cancelled.methods).not.toContain("DELETE");
	expect(cancelled.screens[0]).toContain("Present · SHA256");
	expect(cancelled.screens[0]).toContain("Permanently deletes 1 resolved remote resource");

	const confirmed = await fixture([["\x1b[B", "\r"], ["\x1b"]], "present");
	globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
		const method = init?.method ?? "GET";
		confirmed.methods.push(method);
		if (method === "DELETE") return new Response(null, { status: 204 });
		return new Response(
			JSON.stringify({ metadata: { name: "reviewed-lb", namespace: "demo" }, spec: { domains: [] } }),
			{ status: 200 },
		);
	}) as typeof fetch;
	await handleResourceCommand(
		"delete",
		{ name: "delete", args: "http_loadbalancer reviewed-lb -n demo", text: "/delete" },
		confirmed.ctx,
	);
	expect(confirmed.methods.filter(method => method === "DELETE")).toHaveLength(1);
	expect(confirmed.screens.at(-1)).toContain("Resource delete complete");
});

test("resource review renews after a manifest changes and performs no stale remote write", async () => {
	const h = await fixture([]);
	const pending = handleResourceCommand(
		"create",
		{ name: "create", args: `-f ${h.manifest}`, text: `/create -f ${h.manifest}` },
		h.ctx,
	);
	await waitFor(() => h.screens.length === 1);
	await fs.appendFile(h.manifest, "\n  description: changed-after-review\n");
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("proposal changed"));
	expect(h.methods).not.toContain("POST");
	h.input("\r");
	await pending;
});

test("partial bulk failure retries only the unresolved resource", async () => {
	const h = await fixture([["\x1b[B", "\r"], ["\x1b"]]);
	const secondManifest = path.join(h.root, "resource-2.yaml");
	await fs.writeFile(
		secondManifest,
		[
			"kind: http_loadbalancer",
			"metadata:",
			"  name: retry-lb",
			"  namespace: demo",
			"spec:",
			"  domains:",
			"    - retry.invalid",
			"  routes: []",
			"  origin_pools: []",
		].join("\n"),
	);
	const postNames: string[] = [];
	globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
		const method = init?.method ?? "GET";
		h.methods.push(method);
		if (method === "POST") {
			const body = JSON.parse(String(init?.body)) as { metadata?: { name?: string } };
			const name = body.metadata?.name ?? "unknown";
			postNames.push(name);
			if (name === "retry-lb" && postNames.filter(value => value === name).length === 1)
				return new Response(JSON.stringify({ message: "synthetic partial failure" }), { status: 500 });
			return new Response(JSON.stringify({ metadata: { name, namespace: "demo" }, spec: {} }), { status: 200 });
		}
		return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
	}) as typeof fetch;

	const pending = handleResourceCommand(
		"create",
		{
			name: "create",
			args: `-f ${h.manifest} -f ${secondManifest}`,
			text: `/create -f ${h.manifest} -f ${secondManifest}`,
		},
		h.ctx,
	);
	await waitFor(() => postNames.length === 2);
	expect(postNames).toEqual(["reviewed-lb", "retry-lb"]);
	await waitFor(() => !h.text().includes("Applying resource create"));
	expect(h.text()).toContain("Successful resources will not be retried");
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("proposal changed"));
	expect(h.text()).toContain("http_loadbalancer/retry-lb");
	expect(h.text()).not.toContain("http_loadbalancer/reviewed-lb");
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => postNames.length === 3);
	await pending;
	expect(postNames).toEqual(["reviewed-lb", "retry-lb", "retry-lb"]);
	expect(h.screens.at(-1)).toContain("Resource create complete");
	expect(h.screens.at(-1)).toContain("2 succeeded, 0 failed, 2 total");
}, 15_000);

test("manifest export renews review when the destination changes before confirmation", async () => {
	const h = await fixture([], "present");
	const destination = path.join(h.root, "exports", "lb.yaml");
	const pending = handleExportResourceCommand(
		{
			name: "manifest",
			args: `http_loadbalancer reviewed-lb -n demo -o yaml -f ${destination}`,
			text: `/manifest http_loadbalancer reviewed-lb -n demo -o yaml -f ${destination}`,
		},
		h.ctx,
	);
	await waitFor(() => h.screens.length === 1);
	await fs.mkdir(path.dirname(destination), { recursive: true });
	await fs.writeFile(destination, "user changed this destination");
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("proposal changed"));
	expect(await fs.readFile(destination, "utf8")).toBe("user changed this destination");
	h.input("\r");
	await pending;
});
