export function normalizePluginDisplayName(name: string): string {
	let result = name;
	if (result.startsWith("f5xc-")) result = result.slice(5);
	if (result.length > 0 && result.endsWith("-status")) result = result.slice(0, -7);
	return result || name;
}
