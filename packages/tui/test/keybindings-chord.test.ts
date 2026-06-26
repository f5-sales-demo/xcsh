import { describe, expect, it } from "bun:test";
import { type KeybindingDefinitions, KeybindingsManager } from "@f5-sales-demo/pi-tui/keybindings";

const DEFINITIONS: KeybindingDefinitions = {
	"test.standalone": {
		defaultKeys: "ctrl+a",
		description: "Standalone test binding",
	},
	"test.chord": {
		defaultKeys: "ctrl+x b",
		description: "Chord test binding",
	},
	"test.multiple": {
		defaultKeys: ["ctrl+p", "f4"],
		description: "Multiple alternative bindings",
	},
};

describe("KeybindingsManager.getChordBindings()", () => {
	it("returns single-stroke bindings as sequence length 1", () => {
		const m = new KeybindingsManager(DEFINITIONS);
		const chords = m.getChordBindings();
		expect(chords).toContainEqual({ action: "test.standalone", sequence: ["ctrl+a"] });
	});

	it("returns chord bindings as sequence length 2", () => {
		const m = new KeybindingsManager(DEFINITIONS);
		const chords = m.getChordBindings();
		expect(chords).toContainEqual({ action: "test.chord", sequence: ["ctrl+x", "b"] });
	});

	it("flattens array-valued defaults into multiple ChordBindings", () => {
		const m = new KeybindingsManager(DEFINITIONS);
		const chords = m.getChordBindings();
		const multiples = chords.filter(c => c.action === "test.multiple");
		expect(multiples).toEqual([
			{ action: "test.multiple", sequence: ["ctrl+p"] },
			{ action: "test.multiple", sequence: ["f4"] },
		]);
	});

	it("reflects user overrides (user-supplied chord replaces default)", () => {
		const m = new KeybindingsManager(DEFINITIONS, {
			"test.standalone": "ctrl+x s",
		});
		const chords = m.getChordBindings();
		expect(chords).toContainEqual({ action: "test.standalone", sequence: ["ctrl+x", "s"] });
		expect(chords).not.toContainEqual({ action: "test.standalone", sequence: ["ctrl+a"] });
	});
});

describe("KeybindingsManager — chord leader conflict detection", () => {
	it("reports a conflict when a key is both a chord leader and a standalone binding", () => {
		const m = new KeybindingsManager({
			"test.chord": { defaultKeys: "ctrl+x b" },
			"test.leader-collides": { defaultKeys: "ctrl+x" },
		});
		const conflicts = m.getChordConflicts();
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0]).toEqual({
			key: "ctrl+x",
			standaloneActions: ["test.leader-collides"],
			chordActions: ["test.chord"],
		});
	});

	it("no conflict when the same key is used only as a leader in multiple chords", () => {
		const m = new KeybindingsManager({
			"test.chord-a": { defaultKeys: "ctrl+x a" },
			"test.chord-b": { defaultKeys: "ctrl+x b" },
		});
		expect(m.getChordConflicts()).toEqual([]);
	});
});
