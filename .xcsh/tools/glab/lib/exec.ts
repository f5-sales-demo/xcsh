import type { CustomToolAPI, ExecResult } from "@f5xc-salesdemos/xcsh"

export class GlabAuthError extends Error {
	constructor(message: string) {
		super(`GitLab auth error: ${message}. Run glab_setup with action "login".`)
		this.name = "GlabAuthError"
	}
}

export class GlabNotFoundError extends Error {
	constructor(message: string) {
		super(`GitLab resource not found (404/403): ${message}`)
		this.name = "GlabNotFoundError"
	}
}

export class GlabExecError extends Error {
	constructor(
		message: string,
		public readonly code: number,
	) {
		super(`glab command failed (exit ${code}): ${message}`)
		this.name = "GlabExecError"
	}
}

export async function checkInstalled(pi: Pick<CustomToolAPI, "exec" | "cwd">): Promise<boolean> {
	const result = await pi.exec("which", ["glab"], { cwd: pi.cwd })
	return result.code === 0
}

export async function checkAuth(pi: Pick<CustomToolAPI, "exec" | "cwd">): Promise<boolean> {
	const result = await pi.exec("glab", ["auth", "status"], { cwd: pi.cwd })
	return result.code === 0
}

export async function execGlab(
	pi: Pick<CustomToolAPI, "exec" | "cwd">,
	args: string[],
	signal?: AbortSignal,
): Promise<ExecResult> {
	const result = await pi.exec("glab", args, { signal, cwd: pi.cwd })
	if (result.killed) throw new Error("Command was cancelled")
	if (result.code !== 0) {
		const stderr = result.stderr.toLowerCase()
		if (stderr.includes("auth") || stderr.includes("not logged in") || stderr.includes("token")) {
			throw new GlabAuthError(result.stderr)
		}
		if (stderr.includes("404") || stderr.includes("403") || stderr.includes("not found")) {
			throw new GlabNotFoundError(result.stderr)
		}
		throw new GlabExecError(result.stderr, result.code)
	}
	return result
}

export async function execGlabJson<T = unknown>(
	pi: Pick<CustomToolAPI, "exec" | "cwd">,
	args: string[],
	signal?: AbortSignal,
): Promise<T> {
	const result = await execGlab(pi, args, signal)
	return JSON.parse(result.stdout) as T
}
