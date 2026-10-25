import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSetupStepRunner } from "../src/integrations/setup";

test("native installation runs prerequisites in the reviewed workspace/environment without changing process env", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-native-setup-"));
	try {
		const marker = join(root, "observed.json");
		const previous = process.env.XCSH_SETUP_FIXTURE_KEY;
		const run = createSetupStepRunner(() => undefined, {
			nonInteractiveOutput: "ignore",
			cwd: root,
			environment: { XCSH_SETUP_FIXTURE_KEY: "reviewed-fixture-value" },
		} as any);
		const code = await run({
			kind: "install",
			argv: [
				"/usr/bin/python3",
				"-c",
				`import os,json,pathlib;pathlib.Path(${JSON.stringify(marker)}).write_text(json.dumps(dict(cwd=os.getcwd(),value=os.environ.get('XCSH_SETUP_FIXTURE_KEY'))))`,
			],
			timeoutMs: 10000,
		});
		expect(code).toBe(0);
		expect(JSON.parse(await readFile(marker, "utf8"))).toEqual({ cwd: root, value: "reviewed-fixture-value" });
		expect(process.env.XCSH_SETUP_FIXTURE_KEY).toBe(previous);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
