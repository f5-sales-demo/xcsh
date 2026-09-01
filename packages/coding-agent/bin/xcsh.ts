#!/usr/bin/env bun

import packageJson from "../package.json" with { type: "json" };
import { ensureReleaseBinary, getPackageDistributionChannel, runReleaseBinary } from "../src/npm-binary-bootstrap";

async function main(): Promise<void> {
	const binaryPath = await ensureReleaseBinary({ version: packageJson.version });
	const result = await runReleaseBinary(binaryPath, process.argv.slice(2), getPackageDistributionChannel(import.meta.dir));
	if (result.signalCode) {
		process.kill(process.pid, result.signalCode);
		return;
	}
	process.exitCode = result.exitCode;
}

main().catch(error => {
	console.error(`xcsh: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
