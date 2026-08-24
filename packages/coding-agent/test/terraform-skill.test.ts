import { describe, expect, it } from "bun:test";
import path from "node:path";

const skillPath = path.resolve(import.meta.dir, "../../../.xcsh/skills/terraform-provider/SKILL.md");

describe("terraform-provider skill", () => {
	it("retains the F5 XC activation gate, minimum-settings policy, templates, and safe lifecycle", async () => {
		const skill = await Bun.file(skillPath).text();
		expect(skill).toContain("Activate ONLY when the user explicitly asks");
		expect(skill).toContain("MINIMUM-SETTINGS");
		expect(skill).toContain("http_loadbalancer:");
		expect(skill).toContain("terraform validate");
		expect(skill).toContain("NEVER run `terraform apply`");
	});

	it("adds exact Registry routes without guessed sources or versions", async () => {
		const skill = await Bun.file(skillPath).text();
		expect(skill).toContain("xcsh://registry/provider/<namespace>/<type>");
		expect(skill).toContain("xcsh://registry/module/<namespace>/<name>/<provider>");
		expect(skill).toContain("Never guess");
	});

	it("covers senior validation, outputs, modularity, testing, and troubleshooting", async () => {
		const skill = await Bun.file(skillPath).text();
		expect(skill).toContain("validation {");
		expect(skill).toContain("sensitive = true");
		expect(skill).toContain("variables.tf");
		expect(skill).toContain("outputs.tf");
		expect(skill).toContain("terraform test");
		expect(skill).toContain("*.tftest.hcl");
		expect(skill).toContain("Unsupported argument");
		expect(skill).toContain("State lock");
	});
});
