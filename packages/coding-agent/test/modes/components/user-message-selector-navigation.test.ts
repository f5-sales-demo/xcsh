import { beforeAll, describe, expect, test, vi } from "bun:test";
import { visibleWidth } from "@f5-sales-demo/pi-tui";
import { UserMessageSelectorComponent } from "../../../src/modes/components/user-message-selector";
import { getThemeByName, setThemeInstance } from "../../../src/modes/theme/theme";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));

const messages = [
	{ id: "branch-node-00000001", text: "First synthetic branch point" },
	{ id: "branch-node-00000002", text: "Second synthetic branch point with longer explanatory text" },
];

describe("UserMessageSelectorComponent navigation", () => {
	test("bounds the shared frame and requires the named action before branching", () => {
		const select = vi.fn();
		const component = new UserMessageSelectorComponent(
			messages,
			select,
			() => {},
			() => 20,
		);
		expect(component.render(140).every(line => visibleWidth(line) <= 100)).toBe(true);
		component.handleInput("\r");
		expect(select).not.toHaveBeenCalled();
		expect(Bun.stripANSI(component.render(60).join("\n"))).toContain("Create branch here");
		component.handleInput("\r");
		expect(select).toHaveBeenCalledWith("branch-node-00000002");
	});

	test("returns through details, clears active search, then closes", () => {
		const cancel = vi.fn();
		const component = new UserMessageSelectorComponent(
			messages,
			() => {},
			cancel,
			() => 24,
		);
		component.handleInput("First");
		component.handleInput("\r");
		component.handleInput("\x1b");
		expect(Bun.stripANSI(component.render(80).join("\n"))).toContain("Search:");
		component.handleInput("\x1b");
		expect(Bun.stripANSI(component.render(80).join("\n"))).toContain("Second synthetic");
		expect(cancel).not.toHaveBeenCalled();
		component.handleInput("\x03");
		expect(cancel).not.toHaveBeenCalled();
		component.handleInput("\x1b");
		expect(cancel).toHaveBeenCalledTimes(1);
	});

	test("opens an exact row with the mouse", () => {
		const component = new UserMessageSelectorComponent(
			messages,
			() => {},
			() => {},
			() => 24,
		);
		const lines = component.render(80);
		const row = lines.findIndex(line => Bun.stripANSI(line).includes("00000001"));
		component.routeMouse(
			{ button: 0, col: 2, row, release: false, wheel: null, motion: false, leftClick: true },
			row,
			2,
		);
		expect(Bun.stripANSI(component.render(80).join("\n"))).toContain("branch-node-00000001");
	});
});
