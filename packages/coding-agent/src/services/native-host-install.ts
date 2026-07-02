import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Chrome native-messaging host name (matches the pre-WS-transition host). */
export const NATIVE_HOST_NAME = "com.xcsh.xcsh.chrome_host";

function nativeHostDir(home: string, platform: NodeJS.Platform): string {
	if (platform === "darwin")
		return path.join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts");
	if (platform === "linux") return path.join(home, ".config", "google-chrome", "NativeMessagingHosts");
	throw new Error(`native-host install unsupported on platform '${platform}' (macOS/Linux only)`);
}

/** Single-quote a token for a POSIX `sh` command line (safe for spaces/specials). */
function shQuote(token: string): string {
	return `'${token.replace(/'/g, `'\\''`)}'`;
}

/**
 * Idempotently write the user-level NM host manifest AND its launcher wrapper.
 * Returns the manifest path.
 *
 * Chrome native-messaging manifests support ONLY {name, description, path, type,
 * allowed_origins} — Chrome does NOT honor an `args` field, and when it launches
 * the host it passes the calling extension's origin as argv[1] to `path`. So the
 * manifest CANNOT point straight at the xcsh binary (that would run the default
 * `launch`/TUI, never `chrome-host`). Instead `path` points at a generated
 * executable wrapper that execs the real xcsh with the `chrome-host` subcommand
 * and forwards Chrome's args ("$@"). `launchCommand` is the resolved exec prefix
 * (e.g. ["/usr/local/bin/xcsh"] compiled, or ["/path/bun", "/abs/src/cli.ts"] in
 * dev) — resolved by the CLI layer so this stays a pure writer.
 */
export function installNativeHost(opts: {
	launchCommand: string[];
	extensionIds: string[];
	home?: string;
	platform?: NodeJS.Platform;
}): string {
	if (opts.launchCommand.length === 0) throw new Error("installNativeHost: launchCommand must not be empty");
	const home = opts.home ?? os.homedir();
	const platform = opts.platform ?? process.platform;
	const dir = nativeHostDir(home, platform);
	const manifestPath = path.join(dir, `${NATIVE_HOST_NAME}.json`);
	const wrapperPath = path.join(dir, `${NATIVE_HOST_NAME}.sh`);
	fs.mkdirSync(dir, { recursive: true });

	// Executable launcher: exec the real xcsh with `chrome-host`, forwarding
	// Chrome's origin arg via "$@". 0o755 so Chrome can execute it directly.
	const wrapper = `#!/bin/sh\nexec ${opts.launchCommand.map(shQuote).join(" ")} chrome-host "$@"\n`;
	fs.writeFileSync(wrapperPath, wrapper, { mode: 0o755 });
	fs.chmodSync(wrapperPath, 0o755); // writeFileSync mode is subject to umask; force it.

	const manifest = {
		name: NATIVE_HOST_NAME,
		description: "xcsh Chrome native-messaging host (auto-provisioning bootstrap)",
		path: wrapperPath,
		type: "stdio",
		allowed_origins: opts.extensionIds.map(id => `chrome-extension://${id}/`),
	};
	fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	return manifestPath;
}
