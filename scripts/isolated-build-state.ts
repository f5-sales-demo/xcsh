import { join } from "node:path";

/** Build smoke tests use supported state locations while retaining the real home identity. */
export function isolatedBuildState(directory: string): Record<string, string> {
	return {
		PI_CODING_AGENT_DIR: join(directory, ".xcsh", "agent"),
		XDG_CONFIG_HOME: join(directory, "config"),
		XDG_CACHE_HOME: join(directory, "cache"),
	};
}
