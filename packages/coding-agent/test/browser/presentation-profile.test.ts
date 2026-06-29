import { describe, expect, it } from "bun:test";
import { buildNarration, PROFILES, resolveProfile } from "../../src/browser/presentation-profile";

describe("resolveProfile", () => {
	it("resolves each named profile to its preset axes", () => {
		expect(resolveProfile("guided")).toEqual(PROFILES.guided);
		expect(resolveProfile("instructor")).toEqual(PROFILES.instructor);
		expect(resolveProfile("capture")).toEqual(PROFILES.capture);
		expect(resolveProfile("fast")).toEqual(PROFILES.fast);
	});
	it("falls back to fast for an unknown or missing name", () => {
		expect(resolveProfile("nope")).toEqual(PROFILES.fast);
		expect(resolveProfile(undefined)).toEqual(PROFILES.fast);
	});
	it("uses the session default when no per-run profile is given", () => {
		expect(resolveProfile(undefined, undefined, "guided")).toEqual(PROFILES.guided);
	});
	it("lets a per-run profile beat the session default", () => {
		expect(resolveProfile("fast", undefined, "guided")).toEqual(PROFILES.fast);
	});
	it("merges per-axis overrides over the resolved base", () => {
		const r = resolveProfile("guided", { paceMs: 2500 });
		expect(r.paceMs).toBe(2500);
		expect(r.annotations).toBe(true);
	});

	it("capture profile enables per-step capture + annotations + headless", () => {
		const r = resolveProfile("capture");
		expect(r.capture).toBe("per-step");
		expect(r.annotations).toBe(true);
		expect(r.surface).toBe("headless");
		expect(r.paceMs).toBe(800);
	});

	it("fast profile disables capture and annotations", () => {
		const r = resolveProfile("fast");
		expect(r.capture).toBe("off");
		expect(r.annotations).toBe(false);
	});
});

describe("buildNarration", () => {
	it("returns undefined when narration is 'none'", () => {
		expect(buildNarration("none", { action: "click", selector: "button", description: "Submit" })).toBeUndefined();
	});

	it("returns undefined when the step has no description", () => {
		expect(buildNarration("full", { action: "click", selector: "button" })).toBeUndefined();
	});

	it("returns just the description for 'minimal'", () => {
		expect(
			buildNarration("minimal", {
				action: "click",
				selector: "button:text('Add')",
				description: "Create the policy",
			}),
		).toBe("Create the policy");
	});

	it("returns 'what — why' for 'full' with a click action", () => {
		expect(
			buildNarration("full", { action: "click", selector: "button:text('Add')", description: "Create the policy" }),
		).toBe("Click \"button:text('Add')\" — Create the policy");
	});

	it("returns 'action selector — why' for 'full' with a non-click action", () => {
		expect(
			buildNarration("full", { action: "fill", selector: "textbox[name='Name']", description: "Enter the name" }),
		).toBe("fill textbox[name='Name'] — Enter the name");
	});

	it("handles missing selector gracefully", () => {
		expect(buildNarration("full", { action: "navigate", description: "Go to the page", id: "nav1" })).toBe(
			"navigate — Go to the page",
		);
	});
});
