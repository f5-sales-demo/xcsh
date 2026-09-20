import { expect, test } from "bun:test";
import { ConversationPlans, PLAN_ACTIONS } from "../src/interactions/conversation-plan";

test("split delimiters emit one complete plan and preserve the selected identity", () => {
	const plans = new ConversationPlans();
	for (const part of ["Intro\n<pro", "posed_plan>\n# Plan\nDo it.\n</proposed_", "plan>\n"])
		plans.append("turn:1", part);
	expect(plans.current?.markdown).toBe("# Plan\nDo it.");
	expect(plans.decide(plans.current!.id, "implement")).toEqual({
		mode: "default",
		freshContext: false,
		text: "Implement the plan.",
	});
	expect(plans.decide(plans.current!.id, "implement")).toBeUndefined();
});

test("revisions supersede approvals; only explicit fresh context carries the plan", () => {
	const plans = new ConversationPlans();
	plans.append("turn:1", "<proposed_plan>\nFirst\n</proposed_plan>");
	const old = plans.current!.id;
	plans.append("turn:2", "<proposed_plan>\nSecond\n</proposed_plan>");
	expect(plans.decide(old, "implement")).toBeUndefined();
	expect(plans.decide(plans.current!.id, "fresh")?.text).toEndWith("\n\nSecond");
});

test("stay retains mode and does not submit a user message", () => {
	const plans = new ConversationPlans();
	plans.append("turn", "<proposed_plan>\nPlan\n</proposed_plan>");
	expect(plans.decide(plans.current!.id, "stay")).toEqual({ mode: "plan", freshContext: false });
	expect(PLAN_ACTIONS.map(action => action.label)).toEqual([
		"Yes, implement this plan",
		"Yes, clear context and implement",
		"No, stay in Plan mode",
	]);
});

test("inline or fenced examples are not implementation decisions", () => {
	const plans = new ConversationPlans();
	plans.append(
		"turn",
		"Example <proposed_plan>\nNo\n</proposed_plan>\n```xml\n<proposed_plan>\nNo\n</proposed_plan>\n```",
	);
	expect(plans.current).toBeUndefined();
});
