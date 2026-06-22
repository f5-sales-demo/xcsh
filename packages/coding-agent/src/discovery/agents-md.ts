/**
 * XCSH.md Provider
 *
 * Discovers standalone XCSH.md files by walking up from cwd.
 * This handles XCSH.md files that live in the project root (the human-editable
 * agent init file), not in config directories.
 */
import * as path from "node:path";
import { registerProvider } from "../capability";
import { type ContextFile, contextFileCapability } from "../capability/context-file";
import { readFile } from "../capability/fs";
import type { LoadContext, LoadResult } from "../capability/types";
import { calculateDepth, createSourceMeta } from "./helpers";

const PROVIDER_ID = "agents-md";
const DISPLAY_NAME = "XCSH.md";

/**
 * Load standalone XCSH.md files.
 */
async function loadAgentsMd(ctx: LoadContext): Promise<LoadResult<ContextFile>> {
	const items: ContextFile[] = [];
	const warnings: string[] = [];

	// Walk up from cwd looking for XCSH.md files
	let current = ctx.cwd;

	while (true) {
		const candidate = path.join(current, "XCSH.md");
		const content = await readFile(candidate);

		if (content !== null) {
			const parent = path.dirname(candidate);
			const baseName = parent.split(path.sep).pop() ?? "";

			if (!baseName.startsWith(".")) {
				const fileDir = path.dirname(candidate);
				const calculatedDepth = calculateDepth(ctx.cwd, fileDir, path.sep);

				items.push({
					path: candidate,
					content,
					level: "project",
					depth: calculatedDepth,
					_source: createSourceMeta(PROVIDER_ID, candidate, "project"),
				});
			}
		}

		if (current === (ctx.repoRoot ?? ctx.home)) break; // scanned repo root or home, stop

		// Move to parent directory
		const parent = path.dirname(current);
		if (parent === current) break; // Reached filesystem root
		current = parent;
	}

	return { items, warnings };
}

registerProvider(contextFileCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Standalone XCSH.md files (project-root agent init file)",
	priority: 10,
	load: loadAgentsMd,
});
