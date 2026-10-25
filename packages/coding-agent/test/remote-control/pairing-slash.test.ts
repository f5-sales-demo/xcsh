import { afterEach, expect, spyOn, test } from "bun:test";
import type { Component } from "@f5-sales-demo/pi-tui";
import type { InteractiveModeContext } from "../../src/modes/types";
import * as control from "../../src/remote-control/control";
import { executeBuiltinSlashCommand } from "../../src/slash-commands/builtin-registry";

afterEach(() => {
	mock?.mockRestore();
});
let mock: ReturnType<typeof spyOn> | undefined;
test("/remote pair uses an ephemeral fullscreen QR without persisting the manual code in status", async () => {
	mock = spyOn(control, "runRemoteControl").mockResolvedValue({
		pairing_code: "synthetic-opaque",
		manual_pairing_code: "ABCD-EFGH",
		server_id: "fixture-server",
		environment_id: "fixture-environment",
		expires_at: "2099-01-01T00:00:00Z",
	});
	const statuses: string[] = [],
		errors: string[] = [];
	let shown = false;
	const ctx = {
		editor: { setText() {} },
		showStatus: (text: string) => statuses.push(text),
		showError: (text: string) => errors.push(text),
		showHookCustom: async (
			factory: (ui: unknown, theme: unknown, keys: unknown, done: () => void) => Component,
			options: unknown,
		) => {
			expect(options).toEqual({ overlay: true, fullscreen: true });
			const display = factory({ terminal: { rows: 80 }, requestRender() {} }, {}, {}, () => {});
			expect(display.render(120).some(line => line.startsWith("\x1b[30;47m"))).toBe(true);
			display.handleInput?.("\x1b");
			shown = true;
		},
	} as unknown as InteractiveModeContext;
	expect(await executeBuiltinSlashCommand("/remote pair", { ctx, handleBackgroundCommand() {} })).toBe(true);
	expect(shown).toBe(true);
	expect(statuses).toEqual([]);
	expect(errors).toEqual([]);
});
