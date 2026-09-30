import type { Tool, ToolSession } from "./index";

const submissions = new WeakMap<NonNullable<ToolSession["asyncJobManager"]>, Map<string, string>>();

/** Opt-in background execution uses the existing job ownership, delivery, poll and cancel lifecycle. */
export function wrapAsyncTool(tool: Tool, session: ToolSession): Tool {
	if (!tool.async || !session.asyncJobManager || !session.settings.get("async.enabled")) return tool;
	const manager = session.asyncJobManager;
	let jobsByCall = submissions.get(manager);
	if (!jobsByCall) {
		jobsByCall = new Map();
		submissions.set(manager, jobsByCall);
	}
	const calls = jobsByCall;
	return Object.assign(Object.create(tool), {
		async execute(id: string, args: unknown, signal?: AbortSignal, onUpdate?: unknown, context?: unknown) {
			signal?.throwIfAborted();
			const key = JSON.stringify([
				session.getSessionId?.(),
				session.getActiveModelString?.() ?? session.getModelString?.(),
				tool.name,
				id,
				args,
			]);
			const previous = calls.get(key);
			if (previous)
				return {
					content: [{ type: "text", text: `Tool job already submitted: ${previous}` }],
					details: { jobId: previous, status: manager.getJob(previous)?.status ?? "completed" },
				};
			const jobId = manager.register(
				"task",
				tool.label,
				async ({ signal: jobSignal }) => {
					const result = await tool.execute(id, args, jobSignal, onUpdate as never, context as never);
					return JSON.stringify(result);
				},
				{ id: `tool-${id}` },
			);
			calls.set(key, jobId);
			return {
				content: [{ type: "text", text: `Tool started asynchronously. Job ID: ${jobId}. Use poll or cancel_job.` }],
				details: { jobId, status: "running" },
			};
		},
	}) as Tool;
}
