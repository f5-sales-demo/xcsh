const path = require("node:path");

const MACOS_SYSTEM_NATIVE_ROOT = "/Library/Application Support/xcsh/natives";

function getInstalledNativeCandidates({ platform, packageVersion, addonFilenames, execDir, resolvedExecDir = execDir }) {
	if (platform !== "darwin") return [];

	return [...new Set([
		...addonFilenames.map(filename => path.join(MACOS_SYSTEM_NATIVE_ROOT, packageVersion, filename)),
		...addonFilenames.map(filename => path.resolve(execDir, "..", "libexec", filename)),
		...addonFilenames.map(filename => path.resolve(resolvedExecDir, "..", "libexec", filename)),
	])];
}

function tryLoadCandidates(candidates, load, errors, onLoaded, onError) {
	for (const candidate of candidates) {
		try {
			const loaded = load(candidate);
			onLoaded?.(candidate);
			return loaded;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			errors.push(`${candidate}: ${message}`);
			onError?.(candidate, err);
		}
	}
	return null;
}

function loadInstalledBeforeFallback(installedCandidates, load, errors, prepareFallback, onLoaded, onError) {
	const installed = tryLoadCandidates(installedCandidates, load, errors, onLoaded, onError);
	if (installed) return installed;
	return tryLoadCandidates(prepareFallback(), load, errors, onLoaded, onError);
}

module.exports = { getInstalledNativeCandidates, loadInstalledBeforeFallback, tryLoadCandidates };
