import { afterEach, expect, test } from "bun:test";
import { act, within } from "@testing-library/react";
import { OfficeMockObject } from "office-addin-mock";
import type { Root } from "react-dom/client";
import { type GatewayConfig, MemoryGatewayConfigStore, MockTransport, normalizeGatewayConfig } from "../src/core";
import { initOfficeHost, mountGate, type OfficeLike } from "../src/office/host-adapter";

// `mountGate` uses a raw `createRoot(...).render(...)` (production seam), which
// @testing-library/react's cleanup() does NOT track or unmount. Track this
// test's root + container here and tear them down after EACH test — even if an
// assertion throws — so no gate (and its role=textbox) leaks into the happy-dom
// document shared by every test file in the `bun test` process.
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

test("mountGate with no stored config renders the chat (chat-first) and marks the root .xcsh-panel", async () => {
	const container = document.createElement("div");
	container.id = "root";
	document.body.appendChild(container);
	mountedContainer = container;

	mountedRoot = await act(async () =>
		mountGate(container, {
			store: new MemoryGatewayConfigStore(),
			buildTransport: () => ({ transport: new MockTransport() }),
		}),
	);

	expect(container.classList.contains("xcsh-panel")).toBe(true);
	// Document typography, plus the Office-host marker that reserves header room for
	// Office's own ⓘ button. Distinct classes: `.xcsh-doc` means "sans document
	// typography", NOT "running in an Office task pane".
	expect(container.classList.contains("xcsh-doc")).toBe(true);
	expect(container.classList.contains("xcsh-host-office")).toBe(true);
	const scope = within(container);
	// Chat-first: an unconfigured pane opens on chat, NOT a forced gateway form.
	expect(scope.getByRole("textbox", { name: /message input/i })).toBeDefined();
	expect(scope.queryByLabelText(/gateway url/i)).toBeNull();
	// The gateway form is reachable through the header's "⋯" menu (there is no
	// floating Settings button — it collided with Office's native ⓘ).
	expect(scope.getByRole("button", { name: /more options/i })).toBeDefined();
});

test("mountGate with a stored config renders the chat over the built transport", async () => {
	const container = document.createElement("div");
	container.id = "root";
	document.body.appendChild(container);
	mountedContainer = container;

	const store = new MemoryGatewayConfigStore();
	store.save(normalizeGatewayConfig({ baseUrl: "https://gw.example/anthropic", token: "t" }));
	const built: (GatewayConfig | null)[] = [];

	mountedRoot = await act(async () =>
		mountGate(container, {
			store,
			buildTransport: cfg => {
				built.push(cfg);
				return { transport: new MockTransport() };
			},
		}),
	);

	const scope = within(container);
	expect(scope.getByRole("textbox", { name: /message input/i })).toBeDefined();
	expect(built).toHaveLength(1);
	expect(built[0]?.baseUrl).toBe("https://gw.example");
});
