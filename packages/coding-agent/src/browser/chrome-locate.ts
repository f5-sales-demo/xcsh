import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface LocateChromeOpts {
	settings?: { get(key: string): unknown };
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	exists?: (p: string) => boolean;
	which?: (cmd: string) => string | null;
}

export interface LocatedChrome {
	path: string;
	source: "setting" | "macos" | "path" | "nixos" | "windows";
}

function defaultWhich(cmd: string): string | null {
	try {
		const out = execFileSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf-8" }).trim();
		return out || null;
	} catch {
		return null;
	}
}

export function locateChrome(opts: LocateChromeOpts = {}): LocatedChrome | null {
	const platform = opts.platform ?? process.platform;
	const env = opts.env ?? process.env;
	const exists = opts.exists ?? ((p: string) => fs.existsSync(p));
	const which = opts.which ?? defaultWhich;

	const override = opts.settings?.get("browser.chromePath");
	if (typeof override === "string" && override.trim() && exists(override.trim())) {
		return { path: override.trim(), source: "setting" };
	}

	if (platform === "darwin") {
		const macCandidates = [
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
		];
		for (const c of macCandidates) if (exists(c)) return { path: c, source: "macos" };
		return null;
	}

	if (platform === "win32") {
		const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(Boolean) as string[];
		for (const root of roots) {
			const c = path.join(root, "Google", "Chrome", "Application", "chrome.exe");
			if (exists(c)) return { path: c, source: "windows" };
		}
		return null;
	}

	// linux / other unix
	for (const cmd of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
		const found = which(cmd);
		if (found) return { path: found, source: "path" };
	}
	for (const c of [path.join(env.HOME ?? "", ".nix-profile/bin/chromium"), "/run/current-system/sw/bin/chromium"]) {
		if (c && exists(c)) return { path: c, source: "nixos" };
	}
	return null;
}
