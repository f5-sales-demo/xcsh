import { beforeAll, describe, expect, test, vi } from "bun:test";
import { visibleWidth } from "@f5-sales-demo/pi-tui";
import { TreeSelectorComponent } from "../../../src/modes/components/tree-selector";
import { getThemeByName, setThemeInstance } from "../../../src/modes/theme/theme";
import type { SessionTreeNode } from "../../../src/session/session-manager";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));

function tree(): SessionTreeNode[] {
	return [
		{
			entry: {
				type: "message",
				id: "node-root-00000001",
				parentId: null,
				timestamp: "2026-01-01T00:00:00.000Z",
				message: { role: "user", content: "Root request" },
			},
			children: [
				{
					entry: {
						type: "message",
						id: "node-alternate-0002",
						parentId: "node-root-00000001",
						timestamp: "2026-01-01T00:01:00.000Z",
						message: { role: "user", content: "Alternate path" },
					},
					children: [],
				},
				{
					entry: {
						type: "message",
						id: "node-current-000003",
						parentId: "node-root-00000001",
						timestamp: "2026-01-01T00:02:00.000Z",
						message: { role: "user", content: "Current path" },
					},
					children: [],
				},
			],
		},
	] as unknown as SessionTreeNode[];
}

describe("TreeSelectorComponent navigation", () => {
	test("uses a bounded shared frame and requires an explicit detail action before navigation", () => {
		const onSelect = vi.fn();
		const component = new TreeSelectorComponent(tree(), "node-current-000003", 20, onSelect, () => {});
		const browse = component.render(140);
		expect(browse.every(line => visibleWidth(line) <= 100)).toBe(true);
		expect(Bun.stripANSI(browse.join("\n"))).toContain("Inspect an exact node");
		component.handleInput("\r");
		expect(onSelect).not.toHaveBeenCalled();
		expect(Bun.stripANSI(component.render(60).join("\n"))).toContain("Tree node details");
		component.handleInput("\r");
		expect(onSelect).toHaveBeenCalledWith("node-current-000003");
	});

	test("preserves browse search and position across details and clears search before closing", () => {
		const onCancel = vi.fn();
		const component = new TreeSelectorComponent(tree(), "node-current-000003", 24, () => {}, onCancel);
		component.handleInput("\x1b[200~Alternate\x1b[201~");
		expect(component.getSearchQuery()).toBe("Alternate");
		component.handleInput("\r");
		component.handleInput("\x1b");
		expect(component.getSearchQuery()).toBe("Alternate");
		component.handleInput("\x1b");
		expect(component.getSearchQuery()).toBe("");
		expect(onCancel).not.toHaveBeenCalled();
		component.handleInput("\x1b");
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	test("does not preview a label when its reviewed save is cancelled", async () => {
		const save = vi.fn(async () => false);
		const component = new TreeSelectorComponent(
			tree(),
			"node-current-000003",
			24,
			() => {},
			() => {},
			save,
		);
		component.handleInput("L");
		component.handleInput("draft label");
		component.handleInput("\r");
		await Bun.sleep(1);
		expect(save).toHaveBeenCalledWith("node-current-000003", "draft label");
		component.handleInput("\x1b");
		expect(Bun.stripANSI(component.render(80).join("\n"))).not.toContain("[draft label]");
	});

	test("supports wheel movement and mouse opening of exact visible rows", () => {
		const component = new TreeSelectorComponent(
			tree(),
			"node-current-000003",
			24,
			() => {},
			() => {},
		);
		const initial = component.getSelectedNode()?.entry.id;
		component.routeMouse(
			{ button: 65, col: 0, row: 0, release: false, wheel: 1, motion: false, leftClick: false },
			0,
			0,
		);
		expect(component.getSelectedNode()?.entry.id).not.toBe(initial);
		const lines = component.render(80);
		const marker = component.getSelectedNode()!.entry.id.slice(-8);
		const row = lines.findIndex(line => Bun.stripANSI(line).includes(marker));
		component.routeMouse(
			{ button: 0, col: 4, row, release: false, wheel: null, motion: false, leftClick: true },
			row,
			4,
		);
		expect(Bun.stripANSI(component.render(80).join("\n"))).toContain("Tree node details");
	});
});
