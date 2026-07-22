/**
 * GatewayGate tests.
 *
 * The office wrapper owns the office concerns (persist via GatewayConfigStore,
 * build/tear-down the transport, validate via core's normalizeGatewayConfig) over
 * the shared headless `@f5-sales-demo/xcsh-chat-ui` gate, which owns the
 * config-vs-chat decision, the form, and the Settings affordance. Together they
 * show the gateway config form when no config is stored, or the ChatPanel (over a
 * transport built from the config) once one is.
 */
import { expect, test } from "bun:test";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type GatewayConfig, MemoryGatewayConfigStore, MockTransport, normalizeGatewayConfig } from "../src/core";
import { GatewayGate } from "../src/panel/GatewayGate";

const CONFIG = normalizeGatewayConfig({ baseUrl: "https://gw.example/anthropic", token: "t" });

function fill(label: RegExp, value: string): void {
	fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

test("with no stored config, renders the config form (not the chat)", () => {
	const store = new MemoryGatewayConfigStore();
	render(<GatewayGate store={store} buildTransport={() => ({ transport: new MockTransport() })} />);
	expect(screen.getByLabelText(/gateway url/i)).toBeDefined();
	expect(screen.queryByLabelText(/message input/i)).toBeNull();
});

test("saving a config persists it and switches to the chat over the built transport", async () => {
	const store = new MemoryGatewayConfigStore();
	const built: GatewayConfig[] = [];
	render(
		<GatewayGate
			store={store}
			buildTransport={cfg => {
				built.push(cfg);
				return { transport: new MockTransport() };
			}}
		/>,
	);

	fill(/gateway url/i, "https://gw.example/anthropic");
	fill(/token/i, "sk-1");
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: /save|connect/i }));
	});

	// Persisted and transport built from the saved config.
	expect(store.load()?.token).toBe("sk-1");
	expect(built).toHaveLength(1);
	expect(built[0].baseUrl).toBe("https://gw.example/anthropic");
	// Chat is now shown.
	expect(screen.getByLabelText(/message input/i)).toBeDefined();
});

test("with a stored config, renders the chat directly and builds the transport from it", () => {
	const store = new MemoryGatewayConfigStore();
	store.save(CONFIG);
	const built: GatewayConfig[] = [];
	render(
		<GatewayGate
			store={store}
			buildTransport={cfg => {
				built.push(cfg);
				return { transport: new MockTransport() };
			}}
		/>,
	);
	expect(screen.getByLabelText(/message input/i)).toBeDefined();
	expect(screen.queryByLabelText(/gateway url/i)).toBeNull();
	expect(built).toEqual([CONFIG]);
});

test("the transport is built once, not on every render", () => {
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

	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: /settings/i }));
	});
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
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: /settings/i }));
	});
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
	expect(within(alert).getByText(/invalid token/i)).toBeDefined();
	expect(screen.queryByLabelText(/message input/i)).toBeNull();

	// Reconfigure lands on the config form, prefilled from the stored config.
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: /reconfigure/i }));
	});
	expect((screen.getByLabelText(/gateway url/i) as HTMLInputElement).value).toBe("https://gw.example/anthropic");
});

// A validation failure keeps the form up and surfaces the actionable message.
test("an invalid config surfaces the validator error and stays on the form", async () => {
	const store = new MemoryGatewayConfigStore();
	render(<GatewayGate store={store} buildTransport={() => ({ transport: new MockTransport() })} />);

	fill(/gateway url/i, "http://insecure.example/anthropic");
	fill(/token/i, "sk-1");
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: /save|connect/i }));
	});

	expect(within(screen.getByRole("alert")).getByText(/https/i)).toBeDefined();
	expect(store.load()).toBeNull();
	expect(screen.getByLabelText(/gateway url/i)).toBeDefined();
});
