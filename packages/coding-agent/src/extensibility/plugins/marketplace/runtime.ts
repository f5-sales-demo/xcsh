import { VERSION } from "@f5-sales-demo/pi-utils";
export function assertRuntimeRequirement(
	plugin: { name: string; minimumRuntimeVersion?: string },
	current = VERSION,
): void {
	if (plugin.minimumRuntimeVersion === undefined) return;
	if (!/^\d+\.\d+\.\d+$/.test(plugin.minimumRuntimeVersion)) throw new Error("Invalid minimum xcsh runtime version");
	if (Bun.semver.order(current, plugin.minimumRuntimeVersion) < 0)
		throw new Error(`${plugin.name} requires xcsh ${plugin.minimumRuntimeVersion} or later; upgrade xcsh first`);
}
