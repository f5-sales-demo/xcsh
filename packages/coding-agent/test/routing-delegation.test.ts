import { describe, expect, it } from "bun:test";
import { isDelegationAllowedTool, validateDelegationPlan } from "../src/routing/delegation";

describe("Autonomous Delegation Policy (D01)", () => {
	it("should filter allowed tools to read-only tools", () => {
		expect(isDelegationAllowedTool("read")).toBe(true);
		expect(isDelegationAllowedTool("grep")).toBe(true);
		expect(isDelegationAllowedTool("find")).toBe(true);
		expect(isDelegationAllowedTool("ls")).toBe(true);

		expect(isDelegationAllowedTool("write")).toBe(false);
		expect(isDelegationAllowedTool("edit")).toBe(false);
		expect(isDelegationAllowedTool("bash")).toBe(false);
	});

	it("should validate subtask count cap (at most 3 subtasks)", () => {
		const validPlan = {
			reason: "Investigate multiple files",
			subtasks: [
				{ id: "sub-1", title: "Read auth", description: "Inspect auth.ts", targetFilesOrPaths: ["auth.ts"] },
				{ id: "sub-2", title: "Read user", description: "Inspect user.ts", targetFilesOrPaths: ["user.ts"] },
			],
		};
		expect(validateDelegationPlan(validPlan, 3).valid).toBe(true);

		const oversizedPlan = {
			reason: "Too many tasks",
			subtasks: [
				{ id: "1", title: "t1", description: "d1", targetFilesOrPaths: ["f1"] },
				{ id: "2", title: "t2", description: "d2", targetFilesOrPaths: ["f2"] },
				{ id: "3", title: "t3", description: "d3", targetFilesOrPaths: ["f3"] },
				{ id: "4", title: "t4", description: "d4", targetFilesOrPaths: ["f4"] }, // 4 > 3!
			],
		};
		const validation = validateDelegationPlan(oversizedPlan, 3);
		expect(validation.valid).toBe(false);
		expect(validation.error).toContain("Exceeds max delegation subtasks");
	});
});
