/**
 * Native OS file/folder picker for the local Office bridge.
 *
 * An Office task-pane WebView cannot open a local file dialog, but the bridge runs
 * in-process on the user's machine, so it can. macOS uses `osascript`'s `choose
 * file`/`choose folder`; other platforms have no one-liner equivalent, so the pane
 * falls back to manual path entry there.
 *
 * ASYNC on purpose: the dialog blocks until the user responds, so a synchronous
 * spawn would stall the bridge's event loop (heartbeats, in-flight turns) for the
 * whole time it's open. `Bun.spawn` + `await proc.exited` keeps the bridge live.
 */

export interface PickResult {
	ok: boolean;
	/** Absolute path chosen (no trailing slash), when `ok`. */
	path?: string;
	/** The user dismissed the dialog. */
	canceled?: boolean;
	/** This platform has no native picker; the pane should prompt for a path instead. */
	unsupported?: boolean;
}

/**
 * Open a native picker and resolve the chosen absolute path. Never throws — every
 * failure maps to a `PickResult` flag so the caller can respond gracefully.
 */
export async function pickPathNative(mode: "file" | "folder"): Promise<PickResult> {
	// macOS only for now — osascript is not present on win32/linux.
	if (process.platform !== "darwin") return { ok: false, unsupported: true };
	const script = mode === "folder" ? "POSIX path of (choose folder)" : "POSIX path of (choose file)";
	try {
		const proc = Bun.spawn(["osascript", "-e", script], { stdout: "pipe", stderr: "ignore" });
		const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
		// Cancel raises AppleScript error -128 → non-zero exit, empty stdout.
		if (code !== 0) return { ok: false, canceled: true };
		let path = out.trim();
		if (!path) return { ok: false, canceled: true };
		// `choose folder` yields a trailing slash; normalize to a bare dir path so it
		// matches the sandbox allow-rule root exactly.
		if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
		return { ok: true, path };
	} catch {
		// osascript missing/blocked — treat as unsupported so the pane offers manual entry.
		return { ok: false, unsupported: true };
	}
}
