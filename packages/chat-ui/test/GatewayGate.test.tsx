import { expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { GatewayGate } from "../src/components/GatewayGate";
import type { GatewayConfigDraft, GatewayValidateResult } from "../src/types";

interface Cfg {
	baseUrl: string;
	token: string;
}

function validate(d: GatewayConfigDraft): GatewayValidateResult<Cfg> {
	if (!d.baseUrl.startsWith("https:")) return { ok: false, error: "https required" };
	if (!d.token) return { ok: false, error: "token required" };
	return { ok: true, config: { baseUrl: d.baseUrl, token: d.token } };
}

/**
 * The gate renders NO Settings affordance of its own — the host places it (the
 * office pane puts it in the header's "⋯" menu) and drives it through
 * `api.reconfigure`. These harness children stand in for that host chrome.
 */
function chatWithSettings(baseUrl: string | undefined, reconfigure: () => void) {
	return (
		<div>
			chat over {baseUrl}
			<button type="button" onClick={reconfigure}>
				Settings
			</button>
		</div>
	);
}

test("shows the config form when unconfigured, then the chat after a save", () => {
	let stored: Cfg | null = null;

	function Harness() {
		return (
			<GatewayGate<Cfg>
				config={stored}
				validate={validate}
				onSaveConfig={c => {
					stored = c;
				}}
			>
				{cfg => <div>chat over {cfg?.baseUrl}</div>}
			</GatewayGate>
		);
	}

	const { rerender } = render(<Harness />);
	// Unconfigured → the form (no chat yet).
	expect(screen.getByRole("button", { name: /save|connect/i })).toBeDefined();
	expect(screen.queryByText(/chat over/)).toBeNull();

	fireEvent.change(screen.getByLabelText(/gateway.*url/i), { target: { value: "https://gw/anthropic" } });
	fireEvent.change(screen.getByLabelText(/token/i), { target: { value: "t" } });
	fireEvent.click(screen.getByRole("button", { name: /save|connect/i }));

	// Host persisted the config → re-render with it set.
	rerender(<Harness />);
	expect(screen.getByText("chat over https://gw/anthropic")).toBeDefined();
});

test("the gate renders no Settings chrome of its own — the host owns that affordance", () => {
	const cfg: Cfg = { baseUrl: "https://gw/anthropic", token: "t" };
	const { container } = render(
		<GatewayGate<Cfg> config={cfg} validate={validate} onSaveConfig={() => {}}>
			{c => <div>chat over {c?.baseUrl}</div>}
		</GatewayGate>,
	);
	// A floating button here stacked a second right-aligned row above the host's own
	// header — in the Office pane it collided with Office's native ⓘ button.
	expect(container.querySelector(".gateway-settings-btn")).toBeNull();
	expect(screen.queryByRole("button", { name: /settings/i })).toBeNull();
	expect(screen.getByText(/chat over/)).toBeDefined();
});

test("a host Settings affordance reopens the config form over an existing config", () => {
	const cfg: Cfg = { baseUrl: "https://gw/anthropic", token: "t" };
	render(
		<GatewayGate<Cfg> config={cfg} validate={validate} onSaveConfig={() => {}}>
			{(c, { reconfigure }) => chatWithSettings(c?.baseUrl, reconfigure)}
		</GatewayGate>,
	);
	expect(screen.getByText(/chat over/)).toBeDefined();
	fireEvent.click(screen.getByRole("button", { name: /settings/i }));
	expect(screen.getByRole("button", { name: /save|connect/i })).toBeDefined();
	// Cancel returns to the chat.
	fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
	expect(screen.getByText(/chat over/)).toBeDefined();
});

test("configToDraft prefills the form from the current config when reopened via Settings", () => {
	const cfg: Cfg = { baseUrl: "https://gw/anthropic", token: "t" };
	render(
		<GatewayGate<Cfg> config={cfg} validate={validate} onSaveConfig={() => {}} configToDraft={c => c}>
			{(c, { reconfigure }) => chatWithSettings(c?.baseUrl, reconfigure)}
		</GatewayGate>,
	);
	fireEvent.click(screen.getByRole("button", { name: /settings/i }));
	expect((screen.getByLabelText(/gateway.*url/i) as HTMLInputElement).value).toBe("https://gw/anthropic");
});

test("without configToDraft the reopened form is blank (falls back to initial)", () => {
	const cfg: Cfg = { baseUrl: "https://gw/anthropic", token: "t" };
	render(
		<GatewayGate<Cfg> config={cfg} validate={validate} onSaveConfig={() => {}}>
			{(c, { reconfigure }) => chatWithSettings(c?.baseUrl, reconfigure)}
		</GatewayGate>,
	);
	fireEvent.click(screen.getByRole("button", { name: /settings/i }));
	expect((screen.getByLabelText(/gateway.*url/i) as HTMLInputElement).value).toBe("");
});

test("children get a reconfigure() that reopens the PREFILLED form (recovery path for a bad config)", () => {
	const cfg: Cfg = { baseUrl: "https://gw/anthropic", token: "t" };
	render(
		<GatewayGate<Cfg> config={cfg} validate={validate} onSaveConfig={() => {}} configToDraft={c => c}>
			{(c, { reconfigure }) => (
				<div>
					chat over {c?.baseUrl}
					<button type="button" onClick={reconfigure}>
						fix gateway
					</button>
				</div>
			)}
		</GatewayGate>,
	);
	// The child (e.g. a configure-error banner) drives reconfigure itself — not the
	// generic Settings button — and lands on the prefilled form.
	fireEvent.click(screen.getByRole("button", { name: /fix gateway/i }));
	expect((screen.getByLabelText(/gateway.*url/i) as HTMLInputElement).value).toBe("https://gw/anthropic");
});

test("optional (chat-first): with NO config, renders the chat (config null) — not the form", () => {
	render(
		<GatewayGate<Cfg> config={null} validate={validate} onSaveConfig={() => {}} optional>
			{cfg => <div>chat cfg={cfg === null ? "null" : cfg.baseUrl}</div>}
		</GatewayGate>,
	);
	// Chat-first: no forced form; children rendered with a null config.
	expect(screen.getByText("chat cfg=null")).toBeDefined();
	expect(screen.queryByRole("button", { name: /save|connect/i })).toBeNull();
});

test("optional (chat-first): Settings opens the form and Cancel returns to chat even with no config", () => {
	render(
		<GatewayGate<Cfg> config={null} validate={validate} onSaveConfig={() => {}} optional>
			{(_c, { reconfigure }) => (
				<div>
					the chat
					<button type="button" onClick={reconfigure}>
						Settings
					</button>
				</div>
			)}
		</GatewayGate>,
	);
	fireEvent.click(screen.getByRole("button", { name: /settings/i }));
	expect(screen.getByRole("button", { name: /save|connect/i })).toBeDefined();
	// Cancellable back to chat despite there being no stored config.
	fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
	expect(screen.getByText("the chat")).toBeDefined();
});
