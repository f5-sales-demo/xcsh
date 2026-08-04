import { expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { GatewayConfigForm } from "../src/components/GatewayConfigForm";
import type { GatewayConfigDraft, GatewayValidateResult } from "../src/types";

interface Cfg {
	baseUrl: string;
	token: string;
}

// A stand-in for a host's normalizeGatewayConfig wrapped into the validator contract.
function validate(d: GatewayConfigDraft): GatewayValidateResult<Cfg> {
	if (!d.baseUrl.startsWith("https:")) return { ok: false, error: "Gateway URL must use https" };
	if (!d.token) return { ok: false, error: "A token is required" };
	return { ok: true, config: { baseUrl: d.baseUrl.replace(/\/$/, ""), token: d.token } };
}

function fill(label: RegExp, value: string): void {
	fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

test("requests only the gateway root URL and token", () => {
	render(<GatewayConfigForm validate={validate} onSave={() => {}} />);
	expect(screen.getByLabelText(/gateway.*url/i)).toBeDefined();
	expect(screen.getByLabelText(/token/i)).toBeDefined();
	expect(screen.queryByLabelText(/model/i)).toBeNull();
	expect((screen.getByLabelText(/gateway.*url/i) as HTMLInputElement).placeholder).toBe("https://gateway.example.com");
	expect(screen.getByRole("button", { name: /save|connect/i })).toBeDefined();
});

test("the token field is a masked password input", () => {
	render(<GatewayConfigForm validate={validate} onSave={() => {}} />);
	expect((screen.getByLabelText(/token/i) as HTMLInputElement).type).toBe("password");
});

test("saving a valid URL + token calls onSave with the validated config", () => {
	let saved: Cfg | null = null;
	render(<GatewayConfigForm validate={validate} onSave={c => (saved = c)} />);
	fill(/gateway.*url/i, "https://gw.example/anthropic/");
	fill(/token/i, "sk-secret");
	fireEvent.click(screen.getByRole("button", { name: /save|connect/i }));
	expect(saved).not.toBeNull();
	const cfg = saved as unknown as Cfg;
	expect(cfg.baseUrl).toBe("https://gw.example/anthropic");
	expect(cfg.token).toBe("sk-secret");
	expect(cfg).not.toHaveProperty("model");
});

test("a non-https URL shows the validator's error and does not call onSave", () => {
	let called = false;
	render(<GatewayConfigForm validate={validate} onSave={() => (called = true)} />);
	fill(/gateway.*url/i, "http://gw.example/anthropic");
	fill(/token/i, "t");
	fireEvent.click(screen.getByRole("button", { name: /save|connect/i }));
	expect(called).toBe(false);
	expect(screen.getByRole("alert").textContent).toMatch(/https/i);
});

test("initial values prefill the form", () => {
	render(
		<GatewayConfigForm
			validate={validate}
			onSave={() => {}}
			initial={{ baseUrl: "https://gw.example/anthropic" }}
		/>,
	);
	expect((screen.getByLabelText(/gateway.*url/i) as HTMLInputElement).value).toBe("https://gw.example/anthropic");
});

test("Cancel appears and fires only when onCancel is provided", () => {
	let cancelled = false;
	const { rerender } = render(<GatewayConfigForm validate={validate} onSave={() => {}} />);
	expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
	rerender(<GatewayConfigForm validate={validate} onSave={() => {}} onCancel={() => (cancelled = true)} />);
	fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
	expect(cancelled).toBe(true);
});
