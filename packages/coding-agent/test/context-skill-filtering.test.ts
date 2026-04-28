import { describe, expect, it } from "bun:test";
import { isApplicableToContext, type Skill } from "@f5xc-salesdemos/xcsh/extensibility/skills";

function makeSkill(overrides: Partial<Skill> = {}): Skill {
	return {
		name: "test-skill",
		description: "A test skill",
		filePath: "/tmp/test-skill/SKILL.md",
		baseDir: "/tmp/test-skill",
		source: "test:user",
		...overrides,
	};
}

describe("isApplicableToContext", () => {
	it("includes skill when contexts matches active context", () => {
		const skill = makeSkill({ contexts: ["staging"] });
		expect(isApplicableToContext(skill, "staging")).toBe(true);
	});

	it("excludes skill when contexts does not match active context", () => {
		const skill = makeSkill({ contexts: ["staging"] });
		expect(isApplicableToContext(skill, "production")).toBe(false);
	});

	it("includes skill when contexts field is undefined", () => {
		const skill = makeSkill({ contexts: undefined });
		expect(isApplicableToContext(skill, "staging")).toBe(true);
	});

	it("includes all skills when no active context", () => {
		const skill = makeSkill({ contexts: ["staging"] });
		expect(isApplicableToContext(skill, undefined)).toBe(true);
	});

	it("includes skill when contexts is empty array", () => {
		const skill = makeSkill({ contexts: [] });
		expect(isApplicableToContext(skill, "staging")).toBe(true);
	});
});
