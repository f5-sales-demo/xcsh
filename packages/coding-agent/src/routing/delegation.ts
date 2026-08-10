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

	if (plan.subtasks.length <= 1) {
		return { valid: false, error: "Plan requires >1 subtasks for delegation" };
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
	executor: (
		subtaskPrompt: string,
		options?: { signal?: AbortSignal; allowedTools?: (toolName: string) => boolean },
	) => Promise<{ result: string; tokens: number }>,
	maxTasks = 3,
	options?: { signal?: AbortSignal },
): Promise<{ results: Array<{ id: string; result: string }>; tokensUsed: number }> {
	const validation = validateDelegationPlan(plan, maxTasks);
	if (!validation.valid) {
		return { results: [], tokensUsed: 0 };
	}

	const tasks = plan.subtasks.slice(0, maxTasks).map(async task => {
		if (options?.signal?.aborted) {
			return { id: task.id, result: "Failed: Aborted", tokens: 0 };
		}
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
			const { result, tokens } = await executor(promptPayload, {
				signal: options?.signal,
				allowedTools: isDelegationAllowedTool,
			});
			return { id: task.id, result, tokens };
		} catch (err) {
			return { id: task.id, result: `Failed: ${String(err)}`, tokens: 0 };
		}
	});

	const settled = await Promise.all(tasks);
	let tokensUsed = 0;
	const results = settled.map(s => {
		tokensUsed += s.tokens;
		return { id: s.id, result: s.result };
	});

	return { results, tokensUsed };
}
