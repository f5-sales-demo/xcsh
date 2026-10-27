import { expect, test } from "bun:test";
import { getCapabilities, negotiateCapabilities } from "@f5-sales-demo/xcsh-f5-core";
import { contextlessCliFixture } from "./helpers/contextless-cli";

const contextless = contextlessCliFixture();
for (const command of ["capabilities", "discover"]) {
	test(`public F5 core ${command} is credential-free JSON`, () => {
		const result = Bun.spawnSync(
			[
				process.execPath,
				"--no-env-file",
				new URL("../src/cli.ts", import.meta.url).pathname,
				"f5-core",
				command,
				"--json",
			],
			{ cwd: contextless.cwd, env: { ...process.env, ...contextless.env }, stdout: "pipe", stderr: "pipe" },
		);
		expect(result.exitCode).toBe(0);
		const response = JSON.parse(result.stdout.toString());
		expect(response.specificationHash).toBe(getCapabilities().specificationHash);
		expect(negotiateCapabilities(response).enrichment).toEqual(["discovery"]);
		if (command === "discover") expect(response.kinds).toContain("http_loadbalancer");
	}, 10000);
}
