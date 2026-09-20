import { expect, test } from "bun:test";
import type { ToolSession } from "../../src/tools";
import { enforcePlanModeWrite } from "../../src/tools/plan-mode-guard";

test("conversational planning never grants a file write exception", () => {
	const session = { cwd: "/repo", getPlanModeState: () => ({ enabled: true }) } as ToolSession;
	for (const path of ["README.md", "local://PLAN.md", "/repo/.xcsh/plans/session.md"]) {
		expect(() => enforcePlanModeWrite(session, path)).toThrow("Plan mode: file modifications are not allowed");
	}
});
test("Default mode leaves file authorization to normal permission controls", () => {
	const session = { getPlanModeState: () => undefined } as ToolSession;
	expect(() => enforcePlanModeWrite(session, "README.md")).not.toThrow();
});
