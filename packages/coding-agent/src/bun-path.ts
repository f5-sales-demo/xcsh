import { existsSync } from "node:fs";

const STABLE_BUN_PATH = "/usr/local/bin/bun";

export const bunExecPath: string = existsSync(STABLE_BUN_PATH)
	? STABLE_BUN_PATH
	: (Bun.which("bun") ?? process.execPath);
