#!/usr/bin/env bun

import { spawn } from "bun";
import { bunTestFlags, parseFileWorkers } from "../../../scripts/run-ts-tests";

const packageRoot = new URL("..", import.meta.url).pathname;
const flags = bunTestFlags(parseFileWorkers(process.argv.slice(2)));
const testFiles: string[] = [];
for (const pattern of ["test/*.test.ts", "test/*.test.tsx"]) {
	for await (const file of new Bun.Glob(pattern).scan({ cwd: packageRoot, onlyFiles: true })) testFiles.push(file);
}
testFiles.sort();

async function run(args: string[]): Promise<void> {
	const child = spawn(args, {
		cwd: packageRoot,
		env: Bun.env,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	const code = await child.exited;
	if (code !== 0) process.exit(code);
}

await run([
	"bun",
	"test",
	"--preload",
	"./test/register-dom.ts",
	"--preload",
	"./test/setup.ts",
	...testFiles,
	...flags,
]);
await run([
	"bun",
	"test",
	"--preload",
	"./test/markdown/register-jsdom.ts",
	"--preload",
	"./test/setup.ts",
	"./test/markdown",
	...flags,
]);
