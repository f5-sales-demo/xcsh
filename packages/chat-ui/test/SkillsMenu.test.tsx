import { expect, test } from "bun:test";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SkillsMenu } from "../src/components/SkillsMenu";
import type { SkillMenuItem } from "../src/types";

const SKILLS: SkillMenuItem[] = [
	{ name: "competitive", description: "F5 XC battlecards" },
	{ name: "roi-calculator", description: "ROI / TCO" },
];

test("lists each skill as /name with its description", () => {
	const { container } = render(<SkillsMenu skills={SKILLS} onSelect={() => {}} onClose={() => {}} />);
	const scope = within(container);
	expect(scope.getByText("/competitive")).toBeDefined();
	expect(scope.getByText("F5 XC battlecards")).toBeDefined();
	expect(scope.getByText("/roi-calculator")).toBeDefined();
});

test("picking a skill fires onSelect(name) and closes", () => {
	let picked = "";
	let closed = false;
	render(<SkillsMenu skills={SKILLS} onSelect={n => (picked = n)} onClose={() => (closed = true)} />);
	fireEvent.click(screen.getByRole("menuitem", { name: /competitive/i }));
	expect(picked).toBe("competitive");
	expect(closed).toBe(true);
});

test("shows an empty-safe header when there are no skills", () => {
	const { container } = render(<SkillsMenu skills={[]} onSelect={() => {}} onClose={() => {}} />);
	expect(within(container).getByText(/no skills available/i)).toBeDefined();
});
