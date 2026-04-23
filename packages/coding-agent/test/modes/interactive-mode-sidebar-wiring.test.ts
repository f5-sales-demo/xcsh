import { describe, expect, it } from "bun:test";

// Documentation-style tests for the narrow-terminal hint state machine.
// Task 19's real implementation is inside InteractiveMode.handleSidebarToggle
// with a private #narrowSidebarHintShown latch; this test encodes the same
// state machine as a pure function and locks the invariants.
//
// State machine (per spec §7.6):
//   makeToggleHandler(opts) → (termWidth: number) => "shown-hint" | "no-hint" | "off"
//
// Semantics:
//   - Each call represents one press of Ctrl+X B.
//   - Internal state: visible flag (starts per opts.initialVisible), hintShown flag.
//   - Returns:
//     - "off"        when toggling turns sidebar OFF
//     - "no-hint"    when toggling ON and terminal is wide enough, OR hint already shown
//     - "shown-hint" when toggling ON, terminal below threshold, hint not yet shown this session

function makeToggleHandler(opts: { sidebarWidth: () => number; initialVisible?: boolean }) {
	let visible = opts.initialVisible ?? true;
	let hintShown = false;
	return (termWidth: number): "off" | "no-hint" | "shown-hint" => {
		visible = !visible;
		if (!visible) return "off";
		const threshold = 80 + 1 + opts.sidebarWidth();
		if (termWidth >= threshold) return "no-hint";
		if (hintShown) return "no-hint";
		hintShown = true;
		return "shown-hint";
	};
}

describe("sidebar toggle — narrow-terminal hint state machine", () => {
	it("wide terminal: no hint on toggle-on", () => {
		const toggle = makeToggleHandler({ sidebarWidth: () => 32, initialVisible: false });
		expect(toggle(200)).toBe("no-hint");
	});

	it("narrow terminal: shows hint on first toggle-on", () => {
		const toggle = makeToggleHandler({ sidebarWidth: () => 32, initialVisible: false });
		expect(toggle(50)).toBe("shown-hint");
	});

	it("narrow terminal: hint fires at most once per session — subsequent toggles do not re-show", () => {
		const toggle = makeToggleHandler({ sidebarWidth: () => 32, initialVisible: false });
		expect(toggle(50)).toBe("shown-hint"); // on
		expect(toggle(50)).toBe("off"); // off
		expect(toggle(50)).toBe("no-hint"); // on again, hint already shown
		expect(toggle(50)).toBe("off");
		expect(toggle(50)).toBe("no-hint");
	});

	it("threshold uses the current sidebar.width, not a hardcoded value", () => {
		let width = 32;
		const toggle = makeToggleHandler({ sidebarWidth: () => width, initialVisible: false });
		// 50 < (80 + 1 + 32) = 113 → hint on toggle-on.
		expect(toggle(50)).toBe("shown-hint");
		// reset — fresh handler, different width:
		width = 20;
		const toggle2 = makeToggleHandler({ sidebarWidth: () => width, initialVisible: false });
		// 50 < (80 + 1 + 20) = 101 → hint.
		expect(toggle2(50)).toBe("shown-hint");
		// A wide terminal — no hint for either width.
		const toggle3 = makeToggleHandler({ sidebarWidth: () => 80, initialVisible: false });
		expect(toggle3(200)).toBe("no-hint");
	});

	it("changing sidebar.width mid-session does NOT re-arm the hint", () => {
		let width = 32;
		const toggle = makeToggleHandler({ sidebarWidth: () => width, initialVisible: false });
		expect(toggle(50)).toBe("shown-hint"); // on, hint
		expect(toggle(50)).toBe("off"); // off
		width = 80; // user enlarges sidebar mid-session
		expect(toggle(50)).toBe("no-hint"); // on again — still no hint (one-per-session)
	});
});
