const path = require("node:path");

function getInstalledNativeCandidates({ platform, addonFilenames, resolvedExecDir }) {
	if (platform !== "darwin") return [];

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
