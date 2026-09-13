import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Settings } from "../src/config/settings";
import { MachineProfileService } from "../src/person-profile/machine-profile";
import { PersonProfileService } from "../src/person-profile/service";
import { createAgentSession } from "../src/sdk";
import { SessionManager } from "../src/session/session-manager";

test.each([false, true])(
	"common session builder respects persisted Plan=%s with extensions disabled",
	async plan => {
		const dir = await mkdtemp(join(tmpdir(), "sdk-profile-builder-"));
		const person = new PersonProfileService(join(dir, "private", "user-profile.json"));
		let personCalls = 0,
			machineCalls = 0;
		person.registerProfileCollector({
			id: "synthetic",
			name: "Synthetic",
			available: async () => true,
			collect: async () => {
				personCalls++;
				return { givenName: "Synthetic" };
			},
		});
		const machine = new MachineProfileService(join(dir, "private", "computer-profile.json"), async () => {
			machineCalls++;
			return { hostname: "synthetic-machine" };
		});
		const manager = SessionManager.inMemory(dir);
		if (plan) manager.appendModeChange("plan", { planFilePath: join(dir, "plan.md") });
		const { session } = await createAgentSession({
			cwd: dir,
			agentDir: join(dir, "agent"),
			sessionManager: manager,
			settings: Settings.isolated(),
			disableExtensionDiscovery: true,
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
			personProfileService: person,
			machineProfileService: machine,
			profileDiscovery: true,
			toolNames: ["person_profile", "machine_profile"],
		});
		try {
			await session.steer("Synthetic input");
			expect([personCalls, machineCalls]).toEqual(plan ? [0, 0] : [1, 1]);
			expect((await person.get()).state).toBe(plan ? "empty" : "ready");
			expect(session.getToolByName("person_profile")).toBeDefined();
			expect(session.getToolByName("machine_profile")).toBeDefined();
		} finally {
			await session.dispose();
			await rm(dir, { recursive: true, force: true });
		}
	},
	60000,
);
