import { beforeAll, expect, test } from "bun:test";
import { visibleWidth } from "@f5-sales-demo/pi-tui";
import { RecapMessageComponent } from "../src/modes/components/recap-message";
import { getThemeByName, setThemeInstance } from "../src/modes/theme/theme";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));

test("recap and next action wrap under their text at narrow widths", () => {
	const component = new RecapMessageComponent({
		id: "r",
		sessionId: "s",
		trigger: "manual",
		completedTurnCount: 3,
		createdAt: "2026-09-25T00:00:00.000Z",
		summary: "The validation remains open because the remote worker is unavailable.",
		nextAction: "Resume the worker and rerun the acceptance check.",
	});
	const lines = component.render(30).map(line => line.replace(/\x1b\[[\d;]*m/g, ""));
	for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(30);
	expect(lines[0]).toStartWith("  ↳ Recap: ");
	expect(lines[1]).toStartWith("           ");
	expect(lines.find(line => line.includes("Next:"))).toStartWith("    Next: ");
});
