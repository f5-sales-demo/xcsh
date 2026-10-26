import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { isolatedBuildState } from "./isolated-build-state";

test("compiled smoke state resolves outside the personal profile and leaves home unchanged", async () => {
	const directory = "/tmp/xcsh-isolated-smoke-fixture";
	const environment = { ...Bun.env, ...isolatedBuildState(directory) };
	expect(environment.HOME).toBe(Bun.env.HOME);
	const module = resolve(import.meta.dir, "../packages/utils/src/dirs.ts");
	const child = Bun.spawn([process.execPath, "--eval", `const {getAgentDir,getXCSHConfigDir}=await import(${JSON.stringify(module)}); process.stdout.write(JSON.stringify([getAgentDir(),getXCSHConfigDir()]));`], {
		env: environment, stdout: "pipe", stderr: "pipe",
	});
	const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	expect(code, error).toBe(0);
	expect(JSON.parse(output)).toEqual([`${directory}/.xcsh/agent`, `${directory}/config/xcsh`]);
});
