import { expect, test } from "bun:test";
import { describeSetupPlan, formatSetupCommand } from "../src/integrations/setup";
import type { IntegrationHandle } from "../src/integrations/types";

test("setup command blocks round-trip exact empty, multiline and shell-sensitive argv", () => {
	const argv = [
		"sf",
		"query",
		"",
		"it's literal",
		"$(printf should-not-run)",
		"`literal`",
		"line one\nline two",
		"--json",
	];
	const command = formatSetupCommand(argv);
	const result = Bun.spawnSync(["bash", "-c", `printf '%s\\0' ${command}`]);
	expect(new TextDecoder().decode(result.stdout).split("\0").slice(0, -1)).toEqual(argv);
});
test("setup review retains dependencies, timeouts and verification with readable commands", () => {
	const text = describeSetupPlan({
		name: "Synthetic integration",
		setupPlan: {
			pluginDependencies: ["synthetic"],
			requiredEnvironment: ["SYNTHETIC_TOKEN"],
			profileFields: [],
			steps: [{ kind: "login", argv: ["sf", "org", "login", "web", "--alias", "demo org"], timeoutMs: 90000 }],
			verification: [{ argv: ["sf", "org", "display", "--json"], timeoutMs: 30000 }],
		},
	} as unknown as IntegrationHandle<unknown>);
	expect(text).toContain("sf org login web --alias 'demo org'");
	expect(text).toContain("90000ms");
	expect(text).toContain("sf org display --json");
	expect(text).toContain("synthetic");
	expect(text).toContain("SYNTHETIC_TOKEN");
});
