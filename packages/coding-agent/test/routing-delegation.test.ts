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

	it("should execute read-only delegation plan and format results", async () => {
		const plan = {
			reason: "Test",
			subtasks: [
				{
					id: "test1",
					title: "Read a file",
					description: "Find the auth token",
					targetFilesOrPaths: ["src/auth.ts"],
				},
				{
					id: "test2",
					title: "Read another file",
					description: "Find the DB connection",
					targetFilesOrPaths: ["src/db.ts"],
				},
			],
		};

		const executedPrompts: string[] = [];

		const mockPerform = async (
			prompt: string,
			options?: { signal?: AbortSignal; allowedTools?: (toolName: string) => boolean },
		) => {
			executedPrompts.push(prompt);
			expect(options?.allowedTools).toBeDefined();
			expect(options?.allowedTools?.("read")).toBe(true);
			expect(options?.allowedTools?.("write")).toBe(false);
			return { result: "Auth token is in line 5", tokens: 10 };
		};

		const { executeReadOnlyDelegationPlan } = await import("../src/routing/delegation");
		const { results, tokensUsed } = await executeReadOnlyDelegationPlan(plan, mockPerform);

		expect(results).toHaveLength(2);
		expect(results[0].id).toBe("test1");
		expect(results[0].result).toBe("Auth token is in line 5");
		expect(executedPrompts.some(p => p.includes("Find the auth token"))).toBe(true);
		expect(executedPrompts.some(p => p.includes("src/auth.ts"))).toBe(true);
		expect(executedPrompts.some(p => p.includes("Find the DB connection"))).toBe(true);
		expect(executedPrompts.some(p => p.includes("src/db.ts"))).toBe(true);
		expect(tokensUsed).toBe(20);
	});
});
