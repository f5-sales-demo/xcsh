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

/** Idempotently write the user-level NM host manifest. Returns the manifest path. */
export function installNativeHost(opts: {
	xcshBinPath: string;
	extensionIds: string[];
	home?: string;
	platform?: NodeJS.Platform;
}): string {
	const home = opts.home ?? os.homedir();
	const dir = nativeHostDir(home, opts.platform ?? process.platform);
	const manifestPath = path.join(dir, `${NATIVE_HOST_NAME}.json`);
	const manifest = {
		name: NATIVE_HOST_NAME,
		description: "xcsh Chrome native-messaging host (auto-provisioning bootstrap)",
		path: opts.xcshBinPath,
		type: "stdio",
		allowed_origins: opts.extensionIds.map(id => `chrome-extension://${id}/`),
	};
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	return manifestPath;
}
