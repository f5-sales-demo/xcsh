import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Skill } from "../../src/extensibility/skills";
import { InternalUrlRouter, SkillProtocolHandler } from "../../src/internal-urls";

async function withTempSkillDir<T>(fn: (baseDir: string) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-protocol-test-"));
	try {
		await fs.mkdir(path.join(dir, "skills", "workflow-lifecycle"), { recursive: true });
		await Bun.write(
			path.join(dir, "skills", "workflow-lifecycle", "SKILL.md"),
			"---\nname: workflow-lifecycle\ndescription: Repository governance\n---\n# Workflow Lifecycle\nLine 5\nLine 6",
		);
		await Bun.write(path.join(dir, "skills", "workflow-lifecycle", "helper.sh"), "#!/bin/bash\necho helper");
		return await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

describe("SkillProtocolHandler", () => {
	it("resolves exact namespaced skill URL skill://github:workflow-lifecycle", async () => {
		await withTempSkillDir(async baseDir => {
			const skillDir = path.join(baseDir, "skills", "workflow-lifecycle");
			const skill: Skill = {
				name: "github:workflow-lifecycle",
				description: "Repository governance",
				filePath: path.join(skillDir, "SKILL.md"),
				baseDir: skillDir,
				source: "xcsh-plugins:user",
			};

			const router = new InternalUrlRouter();
			router.register(new SkillProtocolHandler({ getSkills: () => [skill] }));

			const resource = await router.resolve("skill://github:workflow-lifecycle");
			expect(resource.contentType).toBe("text/markdown");
			expect(resource.content).toContain("# Workflow Lifecycle");
		});
	});

	it("resolves slash notation skill://github/workflow-lifecycle", async () => {
		await withTempSkillDir(async baseDir => {
			const skillDir = path.join(baseDir, "skills", "workflow-lifecycle");
			const skill: Skill = {
				name: "github:workflow-lifecycle",
				description: "Repository governance",
				filePath: path.join(skillDir, "SKILL.md"),
				baseDir: skillDir,
				source: "xcsh-plugins:user",
			};

			const router = new InternalUrlRouter();
			router.register(new SkillProtocolHandler({ getSkills: () => [skill] }));

			const resource = await router.resolve("skill://github/workflow-lifecycle");
			expect(resource.content).toContain("# Workflow Lifecycle");
		});
	});

	it("resolves redundant SKILL.md path skill://github/workflow-lifecycle/SKILL.md", async () => {
		await withTempSkillDir(async baseDir => {
			const skillDir = path.join(baseDir, "skills", "workflow-lifecycle");
			const skill: Skill = {
				name: "github:workflow-lifecycle",
				description: "Repository governance",
				filePath: path.join(skillDir, "SKILL.md"),
				baseDir: skillDir,
				source: "xcsh-plugins:user",
			};

			const router = new InternalUrlRouter();
			router.register(new SkillProtocolHandler({ getSkills: () => [skill] }));

			const resource = await router.resolve("skill://github/workflow-lifecycle/SKILL.md");
			expect(resource.content).toContain("# Workflow Lifecycle");
		});
	});

	it("resolves legacy plugin alias skill://github-ops:workflow-lifecycle and skill://github-ops/workflow-lifecycle/SKILL.md", async () => {
		await withTempSkillDir(async baseDir => {
			const skillDir = path.join(baseDir, "skills", "workflow-lifecycle");
			const skill: Skill = {
				name: "github:workflow-lifecycle",
				description: "Repository governance",
				filePath: path.join(skillDir, "SKILL.md"),
				baseDir: skillDir,
				source: "xcsh-plugins:user",
			};

			const router = new InternalUrlRouter();
			router.register(new SkillProtocolHandler({ getSkills: () => [skill] }));

			const resource1 = await router.resolve("skill://github-ops:workflow-lifecycle");
			expect(resource1.content).toContain("# Workflow Lifecycle");

			const resource2 = await router.resolve("skill://github-ops/workflow-lifecycle/SKILL.md");
			expect(resource2.content).toContain("# Workflow Lifecycle");
		});
	});

	it("resolves relative file inside skill directory", async () => {
		await withTempSkillDir(async baseDir => {
			const skillDir = path.join(baseDir, "skills", "workflow-lifecycle");
			const skill: Skill = {
				name: "github:workflow-lifecycle",
				description: "Repository governance",
				filePath: path.join(skillDir, "SKILL.md"),
				baseDir: skillDir,
				source: "xcsh-plugins:user",
			};

			const router = new InternalUrlRouter();
			router.register(new SkillProtocolHandler({ getSkills: () => [skill] }));

			const resource = await router.resolve("skill://github:workflow-lifecycle/helper.sh");
			expect(resource.content).toContain("echo helper");
		});
	});
});
