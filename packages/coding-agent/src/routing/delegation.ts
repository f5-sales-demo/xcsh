import type { ReadOnlyDelegationPlan } from "./types";

const ALLOWED_READ_ONLY_TOOLS = new Set([
	"read",
	"grep",
	"find",
	"ls",
	"lsp",
	"view_file",
	"list_dir",
	"grep_search",
	"search_web",
	"read_url_content",
]);

export function isDelegationAllowedTool(toolName: string): boolean {
	return ALLOWED_READ_ONLY_TOOLS.has(toolName.toLowerCase());
}

export function validateDelegationPlan(plan: ReadOnlyDelegationPlan, maxTasks = 3): { valid: boolean; error?: string } {
	if (!plan || !Array.isArray(plan.subtasks)) {
		return { valid: false, error: "Invalid plan: missing subtasks array" };
	}

	if (plan.subtasks.length === 0) {
		return { valid: false, error: "Plan has 0 subtasks" };
	}

	if (plan.subtasks.length > maxTasks) {
		return { valid: false, error: `Exceeds max delegation subtasks (${plan.subtasks.length} > ${maxTasks})` };
	}

	for (const task of plan.subtasks) {
		if (!task.id || !task.title) {
			return { valid: false, error: "Subtask missing id or title" };
		}
	}

	return { valid: true };
}
