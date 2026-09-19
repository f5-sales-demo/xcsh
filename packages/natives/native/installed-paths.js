const path = require("node:path");

const EMBEDDED_ONLY = Object.freeze({ mode: "embedded-only", candidates: [] });

function getNativeLoadChannel({ platform, addonFilenames, rawExecPath, resolvedExecPath, packageVersion }) {
	if (platform !== "darwin") return EMBEDDED_ONLY;

	const normalizedResolvedPath = path.resolve(resolvedExecPath);
	if (/\/Caskroom\/xcsh\/[^/]+\/bin\/xcsh$/u.test(normalizedResolvedPath)) {
		const resolvedExecDir = path.dirname(normalizedResolvedPath);
		return {
			mode: "installed-only",
			candidates: addonFilenames.map(filename => path.resolve(resolvedExecDir, "..", "libexec", filename)),
		};
	}

	if (rawExecPath === "/usr/local/bin/xcsh" && resolvedExecPath === "/usr/local/bin/xcsh") {
		return {
			mode: "installed-only",
			candidates: addonFilenames.map(filename =>
				path.join("/Library/Application Support/xcsh/natives", packageVersion, filename),
			),
		};
	}

	return EMBEDDED_ONLY;
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

function loadNativeChannel(channel, load, errors, prepareEmbedded, onLoaded, onError) {
	if (channel.mode === "installed-only") {
		return tryLoadCandidates(channel.candidates, load, errors, onLoaded, onError);
	}

	const embeddedCandidate = prepareEmbedded();
	return tryLoadCandidates(embeddedCandidate ? [embeddedCandidate] : [], load, errors, onLoaded, onError);
}

module.exports = { getNativeLoadChannel, loadNativeChannel, tryLoadCandidates };
