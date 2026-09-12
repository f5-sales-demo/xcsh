import type { AgentToolResult } from "./types";

/** A failed execution whose structured result must survive the tool/agent boundary. */
export class AgentToolError<T = unknown> extends Error {
	constructor(
		message: string,
		readonly result: AgentToolResult<T>,
	) {
		super(message);
		this.name = "AgentToolError";
	}
}
