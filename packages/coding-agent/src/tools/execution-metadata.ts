/** Durable executor facts shared by terminal rendering and remote history. */
export interface CommandExecutionDetails {
	kind: "command";
	command: string;
	cwd: string;
	status: "inProgress" | "completed" | "failed";
	aggregatedOutput: string;
	exitCode: number | null;
	durationMs: number | null;
	processId: string | null;
}
export interface CommandExecutionContext {
	command: string;
	cwd: string;
	startedAt: number;
}
export function commandExecution(
	context: CommandExecutionContext,
	output = "",
	result?: { exitCode: number | undefined; failed: boolean },
): CommandExecutionDetails {
	return {
		kind: "command",
		command: context.command,
		cwd: context.cwd,
		status: result ? (result.failed ? "failed" : "completed") : "inProgress",
		aggregatedOutput: output,
		exitCode: result?.exitCode ?? null,
		durationMs: result ? Math.max(0, Math.round(performance.now() - context.startedAt)) : null,
		processId: null,
	};
}

export type FileExecutionChange =
	| { path: string; type: "add" | "delete"; content: string }
	| { path: string; type: "update"; unifiedDiff: string; movePath: string | null };

export interface FileExecutionDetails {
	kind: "fileChange";
	status: "inProgress" | "completed" | "failed" | "declined";
	changes: FileExecutionChange[];
}
