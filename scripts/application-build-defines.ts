import { vertexBuildDefines } from "./vertex-build-credentials";

/** Development qualification never reads or embeds licensed provider build inputs. */
export function applicationBuildDefines(
	args: readonly string[],
	environment: Record<string, string | undefined>,
): Record<string, string> {
	return {
		PI_COMPILED: "true",
		...vertexBuildDefines(
			args.includes("--voice-qualification") ? {} : environment,
			!args.includes("--voice-qualification"),
		),
	};
}
