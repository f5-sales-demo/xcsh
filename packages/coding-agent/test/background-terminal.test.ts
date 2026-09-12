import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe("background terminal detachment", () => {
	it.skipIf(process.platform === "win32")(
		"replaces all standard descriptors without preventing headless work",
		async () => {
			const directory = await mkdtemp(join(tmpdir(), "xcsh-background-terminal-"));
			temporaryDirectories.push(directory);
			const proof = join(directory, "proof.txt");
			const modulePath = resolve(import.meta.dir, "../src/modes/background-terminal.ts");
			const child = Bun.spawn(
				[
					process.execPath,
					"-e",
					`import { detachStandardStreamsForBackground } from ${JSON.stringify(modulePath)}; detachStandardStreamsForBackground(); await Bun.write(${JSON.stringify(proof)}, "detached");`,
				],
				{ stdin: "pipe", stdout: "pipe", stderr: "pipe" },
			);
			child.stdin.end();
			const [exitCode, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);

			expect(exitCode).toBe(0);
			expect(stdout).toBe("");
			expect(stderr).toBe("");
			expect(await Bun.file(proof).text()).toBe("detached");
		},
	);
});
