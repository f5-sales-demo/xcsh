import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { AssistantMessage } from "@f5-sales-demo/pi-ai";
import { _resetSettingsForTest, Settings } from "../../../src/config/settings";
import { AssistantMessageComponent } from "../../../src/modes/components/assistant-message";
import { getThemeByName, setThemeInstance, theme } from "../../../src/modes/theme/theme";

beforeAll(async () => {
	_resetSettingsForTest();
	await Settings.init({ inMemory: true, cwd: process.cwd() });
	setThemeInstance((await getThemeByName("xcsh-dark"))!);
});
afterAll(() => _resetSettingsForTest());

describe("AssistantMessageComponent outcomes", () => {
	it("renders intentional interruption as a warning rather than a failure", () => {
		const message = {
			role: "assistant",
			content: [],
			stopReason: "aborted",
		} as unknown as AssistantMessage;
		const rendered = new AssistantMessageComponent(message).render(80).join("\n");

		expect(rendered).toContain(theme.fg("warning", "Operation aborted"));
		expect(rendered).not.toContain(theme.fg("error", "Operation aborted"));
	});
});
