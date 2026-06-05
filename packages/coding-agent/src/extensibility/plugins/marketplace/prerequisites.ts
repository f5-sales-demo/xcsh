import type { MarketplacePluginEntry } from "./types";

const cache = new Map<string, boolean>();

export async function checkPrerequisite(detectCmd: string): Promise<boolean> {
	const cached = cache.get(detectCmd);
	if (cached !== undefined) return cached;

	try {
		const [cmd, ...args] = detectCmd.split(/\s+/);
		const proc = Bun.spawn([cmd!, ...args], {
			stdout: "ignore",
			stderr: "ignore",
		});
		const exitCode = await proc.exited;
		const available = exitCode === 0;
		cache.set(detectCmd, available);
		return available;
	} catch {
		cache.set(detectCmd, false);
		return false;
	}
}

export async function checkAllPrerequisites(
	plugins: MarketplacePluginEntry[],
): Promise<Map<string, { available: boolean; missing: string[] }>> {
	const results = new Map<string, { available: boolean; missing: string[] }>();

	for (const plugin of plugins) {
		if (!plugin.prerequisites || plugin.prerequisites.length === 0) {
			results.set(plugin.name, { available: true, missing: [] });
			continue;
		}

		const missing: string[] = [];
		for (const prereq of plugin.prerequisites) {
			const ok = await checkPrerequisite(prereq.detectCmd);
			if (!ok) missing.push(prereq.tool);
		}

		results.set(plugin.name, { available: missing.length === 0, missing });
	}

	return results;
}

export function clearPrerequisiteCache(): void {
	cache.clear();
}
