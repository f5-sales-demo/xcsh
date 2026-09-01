import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { parse } from "yaml";

interface WorkflowStep {
	name?: string;
	env?: Record<string, string>;
	run?: string;
}

interface WorkflowJob {
	environment?: string;
	steps?: WorkflowStep[];
}

interface WorkflowDocument {
	jobs?: Record<string, WorkflowJob>;
}

const workflowPath = path.resolve(import.meta.dir, "../../../../.github/workflows/ci.yml");
const expression = (secret: string): string => ["$", `{{ secrets.${secret} }}`].join("");

describe("Corporate Vertex release build credentials", () => {
	it("injects licensed credentials only into protected release binary build steps", async () => {
		const workflow = parse(await Bun.file(workflowPath).text()) as WorkflowDocument;
		for (const jobName of ["build-release", "build-sign-macos"]) {
			const job = workflow.jobs?.[jobName];
			expect(job?.environment, jobName).toBe("release");
			const build = job?.steps?.find(step => step.run?.includes("ci-release-build-binaries.ts"));
			expect(build?.env?.XCSH_VERTEX_OAUTH_CLIENT_ID, jobName).toBe(expression("XCSH_VERTEX_OAUTH_CLIENT_ID"));
			expect(build?.env?.XCSH_VERTEX_OAUTH_CLIENT_SECRET, jobName).toBe(
				expression("XCSH_VERTEX_OAUTH_CLIENT_SECRET"),
			);
		}

		for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
			if (jobName === "build-release" || jobName === "build-sign-macos") continue;
			for (const step of job.steps ?? []) {
				expect(step.env?.XCSH_VERTEX_OAUTH_CLIENT_ID, `${jobName}: ${step.name ?? "unnamed"}`).toBeUndefined();
				expect(step.env?.XCSH_VERTEX_OAUTH_CLIENT_SECRET, `${jobName}: ${step.name ?? "unnamed"}`).toBeUndefined();
			}
		}
	});
});
