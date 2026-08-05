import { formatBytes } from "../tools/render-utils";
import type { SingleResult } from "./types";

export interface TaskOutputSummary {
	agent: string;
	status: string;
	id: string;
	preview: string;
	truncated: boolean;
	fullOutputUrl?: string;
	meta?: { lineCount: number; charSize: string };
}

/** Build the model-facing task summaries and their optional persistent output references. */
export function buildTaskOutputSummaries(
	results: SingleResult[],
	hasPersistentArtifacts: boolean,
): TaskOutputSummary[] {
	return results.map(result => {
		const status = result.aborted
			? "cancelled"
			: result.exitCode === 0 && result.error
				? "merge failed"
				: result.exitCode === 0
					? "completed"
					: `failed (exit ${result.exitCode})`;
		const output = result.output.trim() || result.stderr.trim() || "(no output)";
		const outputCharCount = result.outputMeta?.charCount ?? output.length;
		const fullOutputThreshold = 5000;
		let preview = output;
		let truncated = false;
		if (outputCharCount > fullOutputThreshold) {
			const slice = output.slice(0, fullOutputThreshold);
			const lastNewline = slice.lastIndexOf("\n");
			preview = lastNewline >= 0 ? slice.slice(0, lastNewline) : slice;
			truncated = true;
		}
		return {
			agent: result.agent,
			status,
			id: result.id,
			preview,
			truncated,
			...(truncated && hasPersistentArtifacts ? { fullOutputUrl: `agent://${result.id}` } : {}),
			meta: result.outputMeta
				? {
						lineCount: result.outputMeta.lineCount,
						charSize: formatBytes(result.outputMeta.charCount),
					}
				: undefined,
		};
	});
}
