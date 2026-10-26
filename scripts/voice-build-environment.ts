/** SDK loader paths belong to native helper execution, never general build tools. */
export function voiceBuildEnvironment(
	environment: Record<string, string | undefined>,
	stage: string,
): Record<string, string | undefined> {
	const result = { ...environment };
	if (!["controller", "helper", "relocation", "installed-client", "release-helper", "assembly"].includes(stage)) {
		delete result.DYLD_LIBRARY_PATH;
		delete result.LD_LIBRARY_PATH;
	}
	return result;
}
