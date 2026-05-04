import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { GlabConfig } from "./types";

const CONFIG_FILENAME = "glab-config.json";
const XCSH_DIR = ".xcsh";

export async function loadConfig(cwd: string): Promise<GlabConfig | null> {
	const projectConfig = path.join(cwd, XCSH_DIR, CONFIG_FILENAME);
	try {
		const raw = await fs.readFile(projectConfig, "utf8");
		return JSON.parse(raw) as GlabConfig;
	} catch {
		// try user-level fallback
	}

	const userConfig = path.join(os.homedir(), ".xcsh", "agent", CONFIG_FILENAME);
	try {
		const raw = await fs.readFile(userConfig, "utf8");
		return JSON.parse(raw) as GlabConfig;
	} catch {
		return null;
	}
}

export async function saveConfig(cwd: string, config: GlabConfig): Promise<void> {
	const dir = path.join(cwd, XCSH_DIR);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(path.join(dir, CONFIG_FILENAME), JSON.stringify(config, null, 2), "utf8");
}

export async function resolveProject(paramProject: string | undefined, cwd: string): Promise<string | null> {
	if (paramProject) return paramProject;
	const config = await loadConfig(cwd);
	return config?.project ?? null;
}
