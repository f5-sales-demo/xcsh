import { afterEach, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { getAgentDir, setAgentDir } from "@f5-sales-demo/pi-utils";
import { MachineProfileService } from "../src/person-profile/machine-profile";
import { PersonProfileService } from "../src/person-profile/service";

const previousConfig = process.env.PI_CONFIG_DIR;
const previousAgent = getAgentDir();
afterEach(() => {
	if (previousConfig === undefined) delete process.env.PI_CONFIG_DIR;
	else process.env.PI_CONFIG_DIR = previousConfig;
	setAgentDir(previousAgent);
});

test("private person and machine profiles honor the selected configuration root", () => {
	process.env.PI_CONFIG_DIR = ".xcsh-isolated-test";
	setAgentDir(join(homedir(), ".xcsh-isolated-test", "agent"));
	expect(new PersonProfileService().path).toBe(join(homedir(), ".xcsh-isolated-test", "user-profile.json"));
	expect(new MachineProfileService().path).toBe(join(homedir(), ".xcsh-isolated-test", "computer-profile.json"));
});

test("explicit private fixture paths retain precedence over default configuration", () => {
	expect(new PersonProfileService("/tmp/xcsh-fixture-person.json").path).toBe("/tmp/xcsh-fixture-person.json");
	expect(new MachineProfileService("/tmp/xcsh-fixture-machine.json").path).toBe("/tmp/xcsh-fixture-machine.json");
});
