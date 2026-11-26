import { beforeAll, describe, expect, it, vi } from "bun:test";
import { registerLocales } from "@f5-sales-demo/pi-utils";
import type { IntegrationHandle, IntegrationState } from "../../src/integrations/types";
import { locales } from "../../src/locales/index";
import { initTheme } from "../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../src/modes/types";
import { executeBuiltinSlashCommand, getBuiltinSlashCommandInventory } from "../../src/slash-commands/builtin-registry";

registerLocales(locales);
beforeAll(() => initTheme());

function integration(id: string, state: IntegrationState = "ready", plugin = id) {
	const get = vi.fn(async () => ({
		id,
		name: id,
		plugin,
		state,
		checkedAt: 1,
		durationMs: 1,
		value: { token: "synthetic-private-status-value" },
		...(state === "setup_required" ? { reason: "not_authenticated" as const } : {}),
	}));
	const invalidate = vi.fn();
	const verifyAfterSetup = vi.fn(get);
	return { id, name: id, plugin, get, invalidate, verifyAfterSetup } satisfies IntegrationHandle<unknown>;
}

function runtime(handles: IntegrationHandle<unknown>[] = []) {
	const showStatus = vi.fn();
	const showError = vi.fn();
	const ctx = {
		editor: { setText: vi.fn() },
		sessionManager: { getCwd: () => "/tmp" },
		session: { extensionRunner: { getAllRegisteredIntegrations: () => handles } },
		showStatus,
		showError,
	} as unknown as InteractiveModeContext;
	return { ctx, handleBackgroundCommand() {}, showStatus, showError };
}

describe("/plugin status", () => {
	it("advertises the supported status subcommand", () => {
		expect(getBuiltinSlashCommandInventory().find(command => command.name === "plugin")?.subcommands).toContain(
			"status",
		);
	});

	it("reads only the selected registered handle and omits private values", async () => {
		const selected = integration("gcloud");
		const other = integration("terraform");
		const r = runtime([selected, other]);
		expect(await executeBuiltinSlashCommand("/plugin status gcloud", r)).toBe(true);
		expect(selected.get).toHaveBeenCalledTimes(1);
		expect(other.get).not.toHaveBeenCalled();
		expect(r.showStatus).toHaveBeenCalledWith("gcloud: ready", { plugin: true });
		expect(JSON.stringify(r.showStatus.mock.calls)).not.toContain("synthetic-private-status-value");
		expect(selected.invalidate).not.toHaveBeenCalled();
		expect(selected.verifyAfterSetup).not.toHaveBeenCalled();
	});

	it("reports all registered integrations and concrete setup guidance", async () => {
		const ready = integration("gcloud");
		const setup = integration("platform", "setup_required");
		const r = runtime([ready, setup]);
		await executeBuiltinSlashCommand("/plugin status", r);
		expect(ready.get).toHaveBeenCalledTimes(1);
		expect(setup.get).toHaveBeenCalledTimes(1);
		const text = r.showStatus.mock.calls.map(call => call[0]).join("\n");
		expect(text).toContain("gcloud: ready");
		expect(text).toContain("platform: setup_required (not_authenticated)");
		expect(text).toContain("/plugin setup platform");
		expect(text).not.toContain("synthetic-private-status-value");
	});

	it.each(["gcloud", "gcloud@staging", "gcp-cli"])("selects registered integration by %s", async target => {
		const handle = integration("gcp-cli", "ready", "gcloud@staging");
		const r = runtime([handle]);
		await executeBuiltinSlashCommand(`/plugin status ${target}`, r);
		expect(handle.get).toHaveBeenCalledTimes(1);
		expect(r.showError).not.toHaveBeenCalled();
	});

	it("reports absent integrations explicitly", async () => {
		const r = runtime();
		await executeBuiltinSlashCommand("/plugin status", r);
		expect(r.showStatus).toHaveBeenCalledWith("No enabled plugin integrations are registered.", { plugin: true });
	});

	it("refuses an unregistered target without returning marketplace inventory", async () => {
		const handle = integration("gcloud");
		const r = runtime([handle]);
		await executeBuiltinSlashCommand("/plugin status missing", r);
		expect(r.showError.mock.calls[0]?.[0]).toContain("No enabled integration is registered for missing");
		expect(handle.get).not.toHaveBeenCalled();
		expect(r.showStatus).not.toHaveBeenCalled();
	});

	it.each(["gcloud terraform", "gcloud --json", "--json"])("refuses malformed status arguments: %s", async args => {
		const handle = integration("gcloud");
		const r = runtime([handle]);
		await executeBuiltinSlashCommand(`/plugin status ${args}`, r);
		expect(r.showError.mock.calls[0]?.[0]).toContain("Usage: /plugin status");
		expect(handle.get).not.toHaveBeenCalled();
		expect(r.showStatus).not.toHaveBeenCalled();
	});

	it("refuses context flags with a concrete active-context path", async () => {
		const handle = integration("gcloud");
		const r = runtime([handle]);
		await executeBuiltinSlashCommand("/plugin status gcloud --context example", r);
		expect(r.showError.mock.calls[0]?.[0]).toContain("/context");
		expect(handle.get).not.toHaveBeenCalled();
	});

	it("refuses unknown plugin subcommands instead of silently showing summary", async () => {
		const r = runtime();
		await executeBuiltinSlashCommand("/plugin status-typo gcloud", r);
		expect(r.showError.mock.calls[0]?.[0]).toContain("Unknown plugin subcommand: status-typo");
		expect(r.showStatus).not.toHaveBeenCalled();
	});
});
