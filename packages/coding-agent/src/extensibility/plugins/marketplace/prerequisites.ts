import { logger } from "@f5xc-salesdemos/pi-utils";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Prerequisite {
	tool: string;
	installCmd: string;
	detectCmd: string;
	authDetectCmd?: string;
	authLoginCmd?: string;
}

export interface ToolStatus {
	tool: string;
	installed: boolean;
	authenticated: boolean;
	user?: string;
	error?: string;
}

export interface SetupResult {
	tool: string;
	wasInstalled: boolean;
	installAttempted: boolean;
	installSuccess: boolean;
	authenticated: boolean;
	authLoginCmd?: string;
	user?: string;
	error?: string;
}

// ── Cache ────────────────────────────────────────────────────────────────────

const detectCache = new Map<string, boolean>();

export function clearPrerequisiteCache(): void {
	detectCache.clear();
}

// ── Retry utility ────────────────────────────────────────────────────────────

export async function withRetry<T>(
	fn: () => Promise<T>,
	opts: { maxRetries?: number; baseDelayMs?: number; label?: string } = {},
): Promise<T> {
	const maxRetries = opts.maxRetries ?? 3;
	const baseDelayMs = opts.baseDelayMs ?? 1000;
	let lastError: unknown;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err;
			if (attempt < maxRetries) {
				const delay = baseDelayMs * 2 ** attempt;
				logger.debug(`Retry ${attempt + 1}/${maxRetries} for ${opts.label ?? "operation"} in ${delay}ms`);
				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}
	}

	throw lastError;
}

// ── Tool detection ───────────────────────────────────────────────────────────

export async function checkPrerequisite(detectCmd: string): Promise<boolean> {
	const cached = detectCache.get(detectCmd);
	if (cached !== undefined) return cached;

	try {
		const [cmd, ...args] = detectCmd.split(/\s+/);
		const proc = Bun.spawn([cmd!, ...args], { stdout: "ignore", stderr: "ignore" });
		const exitCode = await proc.exited;
		const available = exitCode === 0;
		detectCache.set(detectCmd, available);
		return available;
	} catch {
		detectCache.set(detectCmd, false);
		return false;
	}
}

// ── Tool installation ────────────────────────────────────────────────────────

export async function installTool(
	installCmd: string,
	opts?: { maxRetries?: number; baseDelayMs?: number },
): Promise<{ success: boolean; error?: string }> {
	try {
		await withRetry(
			async () => {
				const parts = installCmd.split(/\s+/);
				const proc = Bun.spawn(parts, { stdout: "ignore", stderr: "pipe" });
				const exitCode = await proc.exited;
				if (exitCode !== 0) {
					const stderr = await new Response(proc.stderr).text();
					throw new Error(stderr.trim() || `exit code ${exitCode}`);
				}
			},
			{ maxRetries: opts?.maxRetries ?? 2, baseDelayMs: opts?.baseDelayMs ?? 2000, label: installCmd },
		);
		return { success: true };
	} catch (err) {
		return { success: false, error: err instanceof Error ? err.message : String(err) };
	}
}

// ── Auth detection ───────────────────────────────────────────────────────────

export async function checkAuth(
	authDetectCmd: string,
): Promise<{ authenticated: boolean; user?: string; error?: string }> {
	try {
		const parts = authDetectCmd.split(/\s+/);
		const proc = Bun.spawn(parts, { stdout: "pipe", stderr: "pipe" });
		const exitCode = await proc.exited;

		if (exitCode !== 0) {
			return { authenticated: false };
		}

		let user: string | undefined;
		try {
			const stdout = await new Response(proc.stdout).text();
			const parsed = JSON.parse(stdout);
			user = parsed?.user?.name ?? parsed?.Account ?? parsed?.login ?? parsed?.username;
		} catch {
			// Non-JSON output is fine — exit code 0 means authenticated
		}

		return { authenticated: true, user };
	} catch {
		return { authenticated: false, error: "auth check command failed" };
	}
}

// ── Full tool readiness check ────────────────────────────────────────────────

export async function checkToolReady(prereq: Prerequisite): Promise<ToolStatus> {
	const installed = await checkPrerequisite(prereq.detectCmd);
	if (!installed) {
		return { tool: prereq.tool, installed: false, authenticated: false };
	}

	if (!prereq.authDetectCmd) {
		return { tool: prereq.tool, installed: true, authenticated: true };
	}

	const auth = await checkAuth(prereq.authDetectCmd);
	return {
		tool: prereq.tool,
		installed: true,
		authenticated: auth.authenticated,
		user: auth.user,
	};
}

// ── Full setup orchestration for one tool ────────────────────────────────────

export async function setupTool(prereq: Prerequisite): Promise<SetupResult> {
	// Step 1: Check if already installed
	let installed = await checkPrerequisite(prereq.detectCmd);
	let installAttempted = false;
	let installSuccess = false;

	if (!installed) {
		// Step 2: Attempt installation with retry
		installAttempted = true;
		detectCache.delete(prereq.detectCmd);
		const result = await installTool(prereq.installCmd);
		installSuccess = result.success;

		if (!result.success) {
			return {
				tool: prereq.tool,
				wasInstalled: false,
				installAttempted: true,
				installSuccess: false,
				authenticated: false,
				error: `Install failed: ${result.error}`,
			};
		}

		// Verify installation
		detectCache.delete(prereq.detectCmd);
		installed = await checkPrerequisite(prereq.detectCmd);
		if (!installed) {
			return {
				tool: prereq.tool,
				wasInstalled: false,
				installAttempted: true,
				installSuccess: false,
				authenticated: false,
				error: "Install appeared to succeed but tool not found on PATH",
			};
		}
	}

	// Step 3: Check auth
	if (!prereq.authDetectCmd) {
		return {
			tool: prereq.tool,
			wasInstalled: !installAttempted,
			installAttempted,
			installSuccess: !!installAttempted,
			authenticated: true,
		};
	}

	const auth = await checkAuth(prereq.authDetectCmd);
	return {
		tool: prereq.tool,
		wasInstalled: !installAttempted,
		installAttempted,
		installSuccess: installAttempted ? true : false,
		authenticated: auth.authenticated,
		user: auth.user,
		authLoginCmd: auth.authenticated ? undefined : prereq.authLoginCmd,
	};
}

// ── Batch operations ─────────────────────────────────────────────────────────

export async function checkAllPrerequisites(
	plugins: Array<{ name: string; prerequisites?: Prerequisite[] }>,
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

export async function setupAllTools(prerequisites: Prerequisite[]): Promise<SetupResult[]> {
	const results: SetupResult[] = [];
	for (const prereq of prerequisites) {
		results.push(await setupTool(prereq));
	}
	return results;
}
