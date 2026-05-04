import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { GlabConfig } from "./types";

const CONFIG_FILENAME = "glab-config.json";
const XCSH_DIR = ".xcsh";

function homeDir(): string {
	return process.env.HOME || os.homedir();
}

export async function loadConfig(cwd: string): Promise<GlabConfig | null> {
	const projectConfig = path.join(cwd, XCSH_DIR, CONFIG_FILENAME);
	try {
		const raw = await fs.readFile(projectConfig, "utf8");
		return JSON.parse(raw) as GlabConfig;
	} catch {
		// try user-level fallback
	}

	const userConfig = path.join(homeDir(), ".xcsh", "agent", CONFIG_FILENAME);
	try {
		const raw = await fs.readFile(userConfig, "utf8");
		return JSON.parse(raw) as GlabConfig;
	} catch {
		return null;
	}
}

export async function saveConfig(cwd: string, config: GlabConfig): Promise<void> {
	const json = JSON.stringify(config, null, 2);
	const projectDir = path.join(cwd, XCSH_DIR);
	await fs.mkdir(projectDir, { recursive: true });
	await fs.writeFile(path.join(projectDir, CONFIG_FILENAME), json, "utf8");
	const userDir = path.join(homeDir(), ".xcsh", "agent");
	await fs.mkdir(userDir, { recursive: true });
	await fs.writeFile(path.join(userDir, CONFIG_FILENAME), json, "utf8");
}

export async function resolveProject(
	paramProject: string | undefined,
	cwd: string,
	exec?: (cmd: string, args: string[]) => Promise<{ stdout: string; code: number }>,
): Promise<string | null> {
	if (paramProject) return paramProject;
	const config = await loadConfig(cwd);
	if (config?.project) return config.project;
	// Auto-detect: check if cwd has a gitlab remote
	if (exec) {
		try {
			const result = await exec("glab", ["repo", "view", "--output", "json"]);
			if (result.code === 0 && result.stdout) {
				const repo = JSON.parse(result.stdout);
				if (repo.path_with_namespace) return repo.path_with_namespace;
			}
		} catch {
			// Not a GitLab repo or glab not available — fall through
		}
	}
	return null;
}

/** Idempotent startup check: returns a warning string if glab is installed but not configured, null otherwise. */
export async function glabStartupWarning(cwd: string): Promise<string | null> {
	// Fast path: if glab is not installed, nothing to warn about
	const { $which } = await import("@f5xc-salesdemos/pi-utils");
	if (!$which("glab")) return null;
	// Check if config already exists at project or user level
	const config = await loadConfig(cwd);
	if (config?.project) return null;
	// glab is installed but no project configured — emit a one-time warning
	return "GitLab (glab) is installed but no project is configured. Run: glab_setup with action save_project and project GROUP/REPO";
}
