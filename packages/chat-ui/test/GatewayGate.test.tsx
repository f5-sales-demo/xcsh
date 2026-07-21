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
				{cfg => <div>chat over {cfg.baseUrl}</div>}
			</GatewayGate>
		);
	}

	const { rerender } = render(<Harness />);
	// Unconfigured → the form (no chat yet).
	expect(screen.getByRole("button", { name: /save|connect/i })).toBeDefined();
	expect(screen.queryByText(/chat over/)).toBeNull();

	fireEvent.change(screen.getByLabelText(/gateway url/i), { target: { value: "https://gw/anthropic" } });
	fireEvent.change(screen.getByLabelText(/token/i), { target: { value: "t" } });
	fireEvent.click(screen.getByRole("button", { name: /save|connect/i }));

	// Host persisted the config → re-render with it set.
	rerender(<Harness />);
	expect(screen.getByText("chat over https://gw/anthropic")).toBeDefined();
});

test("the Settings button reopens the config form over an existing config", () => {
	const cfg: Cfg = { baseUrl: "https://gw/anthropic", token: "t" };
	render(
		<GatewayGate<Cfg> config={cfg} validate={validate} onSaveConfig={() => {}}>
			{c => <div>chat over {c.baseUrl}</div>}
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
			{c => <div>chat over {c.baseUrl}</div>}
		</GatewayGate>,
	);
	fireEvent.click(screen.getByRole("button", { name: /settings/i }));
	expect((screen.getByLabelText(/gateway url/i) as HTMLInputElement).value).toBe("https://gw/anthropic");
});

test("without configToDraft the reopened form is blank (falls back to initial)", () => {
	const cfg: Cfg = { baseUrl: "https://gw/anthropic", token: "t" };
	render(
		<GatewayGate<Cfg> config={cfg} validate={validate} onSaveConfig={() => {}}>
			{c => <div>chat over {c.baseUrl}</div>}
		</GatewayGate>,
	);
	fireEvent.click(screen.getByRole("button", { name: /settings/i }));
	expect((screen.getByLabelText(/gateway url/i) as HTMLInputElement).value).toBe("");
});
