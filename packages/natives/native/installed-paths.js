const path = require("node:path");

function getInstalledNativeCandidates({ platform, addonFilenames, resolvedExecPath, resolvedExecDir, packageVersion }) {
	if (platform !== "darwin") return [];

	if (resolvedExecPath === "/usr/local/bin/xcsh") {
		return addonFilenames.map(filename =>
			path.join("/Library/Application Support/xcsh/natives", packageVersion, filename),
		);
	}

	const normalized = path.resolve(resolvedExecPath);
	const caskroomExecutable = /\/Caskroom\/xcsh\/[^/]+\/bin\/xcsh$/u.test(normalized);
	if (!caskroomExecutable) return [];
	return addonFilenames.map(filename => path.resolve(resolvedExecDir, "..", "libexec", filename));
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
