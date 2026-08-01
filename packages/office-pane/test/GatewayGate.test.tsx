/**
 * GatewayGate tests.
 *
 * The office wrapper owns the office concerns (persist via GatewayConfigStore,
 * build/tear-down the transport, validate via core's normalizeGatewayConfig) over
 * the shared headless `@f5-sales-demo/xcsh-chat-ui` gate, which owns the
 * config-vs-chat decision and the form. The Settings affordance itself is the
 * pane's — it lives in the header's "⋯" menu and drives `api.reconfigure`.
 *
 * CHAT-FIRST (#2171): the pane runs the shared gate in `optional` mode — an
 * unconfigured pane opens straight into chat over xcsh's existing provider, with
 * the gateway form demoted to Settings. A stored config additionally configures
 * xcsh's provider; a `provider-4xx` turn error auto-opens the form.
 */
import { expect, test } from "bun:test";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
	type ChatRequestMsg,
	type GatewayConfig,
	MemoryGatewayConfigStore,
	MockTransport,
	normalizeGatewayConfig,
} from "../src/core";
import { GatewayGate } from "../src/panel/GatewayGate";

const CONFIG = normalizeGatewayConfig({ baseUrl: "https://gw.example/anthropic", token: "t" });

function fill(label: RegExp, value: string): void {
	fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** Flush the connect→(provision)→ready microtask chain. */
async function settle(): Promise<void> {
	await act(async () => {
		await new Promise(r => setTimeout(r, 0));
	});
}

/**
 * Open the gateway form the way a user does: the header's "⋯" menu → Settings.
 * (There is no floating Settings button — in an Office task pane it collided with
 * Office's own ⓘ, so the affordance moved into the pane's control row.)
 */
async function openSettings(): Promise<void> {
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: /more options/i }));
	});
	await act(async () => {
		fireEvent.click(screen.getByRole("menuitem", { name: /settings/i }));
	});
}

test("chat-first: with NO stored config, opens the chat directly (not the form), built with a null config", async () => {
	const store = new MemoryGatewayConfigStore();
	const built: (GatewayConfig | null)[] = [];
	render(
		<GatewayGate
			store={store}
			buildTransport={cfg => {
				built.push(cfg);
				return { transport: new MockTransport() };
			}}
		/>,
	);
	await settle();
	// Chat-first: message input shown, NO forced gateway form.
	expect(screen.getByLabelText(/message input/i)).toBeDefined();
	expect(screen.queryByLabelText(/gateway url/i)).toBeNull();
	// Transport built with a null config — chat runs over xcsh's existing provider.
	expect(built).toEqual([null]);
	// Config is still reachable — through the header's "⋯" menu, not a floating button.
	expect(screen.queryByRole("button", { name: /^settings$/i })).toBeNull();
	expect(screen.getByRole("button", { name: /more options/i })).toBeDefined();
});

test("saving a config via Settings persists it and rebuilds the transport from it", async () => {
	const store = new MemoryGatewayConfigStore();
	const built: (GatewayConfig | null)[] = [];
	render(
		<GatewayGate
			store={store}
			buildTransport={cfg => {
				built.push(cfg);
				return { transport: new MockTransport() };
			}}
		/>,
	);

	// Chat-first opens on chat → open Settings to reach the form.
	await openSettings();
	fill(/gateway url/i, "https://gw.example/anthropic");
	fill(/token/i, "<XC_API_TOKEN>");
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: /save|connect/i }));
	});

	// Persisted, and the transport rebuilt from the saved config (built first with
	// null for chat-first, then with the config).
	expect(store.load()?.token).toBe("<XC_API_TOKEN>");
	expect(built[0]).toBeNull();
	expect(built[built.length - 1]?.baseUrl).toBe("https://gw.example/anthropic");
	expect(screen.getByLabelText(/message input/i)).toBeDefined();
});

test("with a stored config, renders the chat and builds the transport from it", async () => {
	const store = new MemoryGatewayConfigStore();
	store.save(CONFIG);
	const built: (GatewayConfig | null)[] = [];
	render(
		<GatewayGate
			store={store}
			buildTransport={cfg => {
				built.push(cfg);
				return { transport: new MockTransport() };
			}}
		/>,
	);
	await settle();
	expect(screen.getByLabelText(/message input/i)).toBeDefined();
	expect(screen.queryByLabelText(/gateway url/i)).toBeNull();
	expect(built).toEqual([CONFIG]);
});

test("the transport is built once, not on every render", async () => {
	const store = new MemoryGatewayConfigStore();
	store.save(CONFIG);
	let calls = 0;
	const { rerender } = render(
		<GatewayGate
			store={store}
			buildTransport={() => {
				calls += 1;
				return { transport: new MockTransport() };
			}}
		/>,
	);
	await settle();
	rerender(
		<GatewayGate
			store={store}
			buildTransport={() => {
				calls += 1;
				return { transport: new MockTransport() };
			}}
		/>,
	);
	expect(calls).toBe(1);
});

test("the Settings affordance reopens the form prefilled, and Cancel returns to chat", async () => {
	const store = new MemoryGatewayConfigStore();
	store.save(CONFIG);
	render(<GatewayGate store={store} buildTransport={() => ({ transport: new MockTransport() })} />);

	await openSettings();
	// Form is shown, prefilled with the stored base URL.
	expect((screen.getByLabelText(/gateway url/i) as HTMLInputElement).value).toBe("https://gw.example/anthropic");

	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
	});
	// Back to chat.
	expect(screen.getByLabelText(/message input/i)).toBeDefined();
});

test("reconfiguring via Settings disposes the superseded transport (no socket leak)", async () => {
	const store = new MemoryGatewayConfigStore();
	store.save(CONFIG);
	const built: MockTransport[] = [];
	render(
		<GatewayGate
			store={store}
			buildTransport={() => {
				const t = new MockTransport();
				built.push(t);
				return { transport: t };
			}}
		/>,
	);
	expect(built).toHaveLength(1);
	expect(built[0].state).not.toBe("closed");

	// Settings → change the gateway → Save a NEW config.
	await openSettings();
	fill(/gateway url/i, "https://gw2.example/anthropic");
	fill(/token/i, "t2");
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: /save|connect/i }));
	});

	// A new transport is built and the superseded one is disposed (state closed).
	expect(built).toHaveLength(2);
	expect(built[0].state).toBe("closed");
	expect(built[1].state).not.toBe("closed");
});

test("a failed provider configure surfaces the error and Reconfigure reopens the prefilled form (#2134)", async () => {
	const store = new MemoryGatewayConfigStore();
	store.save(CONFIG);
	render(
		<GatewayGate
			store={store}
			buildTransport={() => ({
				transport: new MockTransport(),
				// Simulates the bridge answering configure_error (e.g. a bad token).
				provision: () => Promise.reject(new Error("configure_error: invalid token")),
			})}
		/>,
	);

	// The failure is a visible, non-silent alert — chat is NOT shown.
	const alert = await waitFor(() => screen.getByRole("alert"));
	expect(within(alert).getByText(/provider configuration failed/i)).toBeDefined();
	expect(screen.queryByLabelText(/message input/i)).toBeNull();

	// Reconfigure lands on the config form, prefilled from the stored config.
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: /reconfigure/i }));
	});
	expect((screen.getByLabelText(/gateway url/i) as HTMLInputElement).value).toBe("https://gw.example/anthropic");
});

test("a provider-4xx turn error auto-opens the gateway config form (#2171 auth recovery)", async () => {
	const store = new MemoryGatewayConfigStore();
	store.save(CONFIG);
	let mock: MockTransport | undefined;
	render(
		<GatewayGate
			store={store}
			buildTransport={() => {
				mock = new MockTransport();
				return { transport: mock };
			}}
		/>,
	);
	// Provisioning settles to ready (no provision hook), chat is shown.
	await settle();
	expect(screen.getByLabelText(/message input/i)).toBeDefined();

	// Send a turn, then the provider rejects it with a 4xx (bad gateway token).
	fireEvent.click(screen.getByRole("button", { name: /summarize/i }));
	fireEvent.click(screen.getByRole("button", { name: /send/i }));
	const req = mock?.sent.find((m): m is ChatRequestMsg => m.type === "chat_request");
	if (!req) throw new Error("expected a chat_request to have been sent");
	await act(async () => {
		mock?.emit({ type: "chat_error", id: req.id, reason: "provider-4xx" });
	});

	// The gateway config form auto-opened, prefilled from the stored config.
	expect((screen.getByLabelText(/gateway url/i) as HTMLInputElement).value).toBe("https://gw.example/anthropic");
});

// A validation failure keeps the form up and surfaces the actionable message.
test("an invalid config surfaces the validator error and stays on the form", async () => {
	const store = new MemoryGatewayConfigStore();
	render(<GatewayGate store={store} buildTransport={() => ({ transport: new MockTransport() })} />);

	// Chat-first → open Settings to reach the form.
	await openSettings();
	fill(/gateway url/i, "http://insecure.example/anthropic");
	fill(/token/i, "<XC_API_TOKEN>");
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: /save|connect/i }));
	});

	expect(within(screen.getByRole("alert")).getByText(/https/i)).toBeDefined();
	expect(store.load()).toBeNull();
	expect(screen.getByLabelText(/gateway url/i)).toBeDefined();
});
