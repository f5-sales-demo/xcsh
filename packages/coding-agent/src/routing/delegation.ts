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

export async function executeReadOnlyDelegationPlan(
	plan: ReadOnlyDelegationPlan,
	executor: (subtaskPrompt: string) => Promise<string>,
	maxTasks = 3,
): Promise<Array<{ id: string; result: string }>> {
	const validation = validateDelegationPlan(plan, maxTasks);
	if (!validation.valid) {
		return [];
	}

	const results: Array<{ id: string; result: string }> = [];
	for (const task of plan.subtasks.slice(0, maxTasks)) {
		try {
			const promptPayload = [
				`Task: ${task.title}`,
				task.description ? `Description: ${task.description}` : "",
				task.targetFilesOrPaths && task.targetFilesOrPaths.length > 0
					? `Target Files: ${task.targetFilesOrPaths.join(", ")}`
					: "",
				`Allowed Tools: ${Array.from(ALLOWED_READ_ONLY_TOOLS).join(", ")}. Do not attempt to use any other tools.`,
			]
				.filter(Boolean)
				.join("\n");
			const res = await executor(promptPayload);
			results.push({ id: task.id, result: res });
		} catch (err) {
			results.push({ id: task.id, result: `Failed: ${String(err)}` });
		}
	}
	return results;
}
