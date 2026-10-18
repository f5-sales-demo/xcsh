const fs = require("node:fs");

function exportZigEnvironment(environment) {
	const names = ["GITHUB_PATH", "GITHUB_ENV", "ZIG_PATH_TO_EXPORT", "ZIG_CACHE_TO_EXPORT"];
	for (const name of names) {
		const value = environment[name];
		if (typeof value !== "string" || value.length === 0 || /[\0\r\n]/.test(value)) {
			throw new Error(`Invalid single-line value for ${name}`);
		}
	}
	fs.appendFileSync(environment.GITHUB_PATH, `${environment.ZIG_PATH_TO_EXPORT}\n`, "utf8");
	fs.appendFileSync(
		environment.GITHUB_ENV,
		`ZIG_GLOBAL_CACHE_DIR=${environment.ZIG_CACHE_TO_EXPORT}\nZIG_LOCAL_CACHE_DIR=${environment.ZIG_CACHE_TO_EXPORT}\n`,
		"utf8",
	);
}

module.exports = { exportZigEnvironment };

if (require.main === module) {
	try {
		exportZigEnvironment(process.env);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
