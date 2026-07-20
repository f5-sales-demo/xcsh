import { afterEach, expect, test } from "bun:test";
import { act, within } from "@testing-library/react";
import { OfficeMockObject } from "office-addin-mock";
import type { Root } from "react-dom/client";
import { MockTransport } from "../src/core";
import { initOfficeHost, mountPanel, type OfficeLike } from "../src/office/host-adapter";

// `mountPanel` uses a raw `createRoot(...).render(...)` (production seam), which
// @testing-library/react's cleanup() does NOT track or unmount. Track this
// test's root + container here and tear them down after EACH test — even if an
// assertion throws — so no ChatPanel (and its Fluent role=textbox) leaks into
// the happy-dom document shared by every test file in the `bun test` process.
let mountedRoot: Root | undefined;
let mountedContainer: HTMLElement | undefined;

afterEach(async () => {
	if (mountedRoot) {
		await act(async () => {
			mountedRoot?.unmount();
		});
		mountedRoot = undefined;
	}
	mountedContainer?.remove();
	mountedContainer = undefined;
});

/**
 * Build an office-addin-mock `OfficeMockObject` seeded with an `onReady` and a
 * `context.host`. Scalar reads on `OfficeMockObject` are gated behind
 * `load()`/`sync()`, so `context.host` is driven ready here in the test setup.
 */
async function mockOffice(seed: { onReady: OfficeLike["onReady"]; context?: { host?: unknown } }): Promise<OfficeLike> {
	// OfficeMockObject is dynamically typed; assert the subset this test drives
	// (a load/sync-gated `context`) plus the OfficeLike surface it stands in for.
	const mock = new OfficeMockObject(seed as Record<string, unknown>) as unknown as OfficeLike & {
		context: { host?: unknown; load(properties: string): void; sync(): Promise<void> };
	};
	if (seed.context !== undefined && "host" in seed.context) {
		mock.context.load("host");
		await mock.context.sync();
	}
	return mock;
}

test("initOfficeHost resolves the detected host from a mocked Excel context", async () => {
	const office = await mockOffice({
		onReady: () => Promise.resolve({ host: "Excel" }),
		context: { host: "Excel" },
	});

	const result = await initOfficeHost(office);

	expect(result.host).toBe("Excel");
});

test("initOfficeHost resolves only after Office.onReady fires", async () => {
	let fire!: (info: { host: string }) => void;
	const ready = new Promise<{ host: string }>(resolve => {
		fire = resolve;
	});

	// Hand-rolled stub (host-detection exercises no load/sync proxy semantics).
	const office: OfficeLike = { onReady: () => ready, context: { host: "Word" } };

	let settled = false;
	const pending = initOfficeHost(office).then(r => {
		settled = true;
		return r;
	});

	// Flush microtasks: initOfficeHost must not resolve before onReady fires.
	await Promise.resolve();
	expect(settled).toBe(false);

	fire({ host: "Word" });
	const result = await pending;
	expect(settled).toBe(true);
	expect(result.host).toBe("Word");
});

test('unknown or absent host maps to the "unknown" fallback without throwing', async () => {
	const absent = await mockOffice({ onReady: () => Promise.resolve({}) });
	expect((await initOfficeHost(absent)).host).toBe("unknown");

	const unrecognized = await mockOffice({
		onReady: () => Promise.resolve({ host: "Frobnicator" }),
		context: { host: "Frobnicator" },
	});
	expect((await initOfficeHost(unrecognized)).host).toBe("unknown");
});

test("mountPanel renders the ChatPanel shell with an injected transport", async () => {
	const container = document.createElement("div");
	container.id = "root";
	document.body.appendChild(container);
	// Register for teardown BEFORE rendering so afterEach unmounts even if an
	// assertion below throws (raw createRoot renders are not tracked by cleanup()).
	mountedContainer = container;
	mountedRoot = await act(async () => mountPanel(container, new MockTransport()));

	// Scope queries to this container: sibling package tests may leave their own
	// rendered ChatPanels in the shared happy-dom document.
	const panel = within(container);
	expect(panel.getByRole("log", { name: /conversation/i })).toBeDefined();
	expect(panel.getByRole("textbox")).toBeDefined();
});
