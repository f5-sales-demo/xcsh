import { resolveLocalUrlToPath } from "../internal-urls";
import type { ToolSession } from ".";
import { resolveToCwd } from "./path-utils";
import { ToolError } from "./tool-errors";

const LOCAL_URL_PREFIX = "local://";

export function resolvePlanPath(session: ToolSession, targetPath: string): string {
	if (targetPath.startsWith(LOCAL_URL_PREFIX)) {
		return resolveLocalUrlToPath(targetPath, {
			getArtifactsDir: session.getArtifactsDir,
			getSessionId: session.getSessionId,
		});
	}

	return resolveToCwd(targetPath, session.cwd);
}

export function enforcePlanModeWrite(
	session: ToolSession,
	_targetPath: string,
	_options?: { move?: string; op?: "create" | "update" | "delete" },
): void {
	const state = session.getPlanModeState?.();
	if (!state?.enabled) return;

	throw new ToolError("Plan mode: file modifications are not allowed.");
}
