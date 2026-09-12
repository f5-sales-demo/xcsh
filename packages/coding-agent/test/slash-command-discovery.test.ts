import { describe, expect, it } from "bun:test";
import {
	inferSlashCommandScope,
	resolveSlashCommandDiscovery,
	type SlashCommandDiscoveryCandidate,
} from "../src/modes/slash-command-discovery";

function candidate(
	name: string,
	behavior: "execution" | "prompt expansion",
	provenance: string,
	scope: "native" | "session" | "project" | "user" | "path",
	shadowed?: string[],
): SlashCommandDiscoveryCandidate {
	return {
		name,
		description: `${provenance} description`,
		discovery: { behavior, provenance, scope, shadowed },
	};
}

describe("slash command discovery", () => {
	it("shows one runtime winner with behavior, provenance, scope, and every shadowed identity", () => {
		const resolved = resolveSlashCommandDiscovery([
			candidate("deploy", "execution", "xcsh built-in", "native"),
			candidate("deploy", "execution", "extension /project/deploy.ts", "project"),
			candidate("deploy", "execution", "TypeScript /home/me/deploy.ts", "user"),
			candidate("deploy", "prompt expansion", "Codex prompt (/project/deploy.md)", "project", [
				"Claude (user prompt expansion)",
			]),
			candidate("skill:review", "prompt expansion", "skill xcsh (/project/SKILL.md)", "project"),
		]);

		expect(resolved).toHaveLength(2);
		expect(resolved[0]?.name).toBe("deploy");
		expect(resolved[0]?.description).toStartWith("Execution · native scope · shadows");
		expect(resolved[0]?.description).toContain("· xcsh built-in · xcsh built-in description");
		expect(resolved[0]?.description).toContain("extension /project/deploy.ts (project execution)");
		expect(resolved[0]?.description).toContain("TypeScript /home/me/deploy.ts (user execution)");
		expect(resolved[0]?.description).toContain("Codex prompt (/project/deploy.md) (project prompt expansion)");
		expect(resolved[0]?.description).toContain("Claude (user prompt expansion)");
		expect(resolved[1]?.description).toContain("Prompt expansion");
	});

	it("preserves argument completion and inline-hint behavior on the winning entry", () => {
		const getArgumentCompletions = () => [{ value: "status", label: "status" }];
		const getInlineHint = () => "status";
		const [resolved] = resolveSlashCommandDiscovery([
			{
				...candidate("route", "execution", "xcsh built-in", "native"),
				getArgumentCompletions,
				getInlineHint,
			},
		]);

		expect(resolved?.getArgumentCompletions).toBe(getArgumentCompletions);
		expect(resolved?.getInlineHint).toBe(getInlineHint);
	});

	it("classifies native, project, user, and external paths deterministically", () => {
		expect(inferSlashCommandScope("bundled:review", "/work/project", "/home/me")).toBe("native");
		expect(inferSlashCommandScope("/work/project/.xcsh/ext.ts", "/work/project", "/home/me")).toBe("project");
		expect(inferSlashCommandScope("/home/me/.xcsh/ext.ts", "/work/project", "/home/me")).toBe("user");
		expect(inferSlashCommandScope("/opt/xcsh/ext.ts", "/work/project", "/home/me")).toBe("path");
	});
});
