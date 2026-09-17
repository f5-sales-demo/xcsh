import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Settings } from "../src/config/settings";
import { ProfileBuilder } from "../src/person-profile/builder";
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

test("profile builders for the same paths share one process-wide refresh", async () => {
	const dir = await mkdtemp(join(tmpdir(), "profile-coordinator-"));
	const person = new PersonProfileService(join(dir, "private", "user-profile.json"));
	let calls = 0;
	person.registerProfileCollector({
		id: "synthetic",
		name: "Synthetic",
		available: async () => true,
		collect: async () => {
			calls++;
			await Bun.sleep(20);
			return { givenName: "Synthetic" };
		},
	});
	const machine = new MachineProfileService(join(dir, "private", "computer-profile.json"), async () => ({}));
	const first = new ProfileBuilder(person, machine, () => true);
	const second = new ProfileBuilder(person, machine, () => true);
	await Promise.all([first.refresh(), second.refresh()]);
	expect(calls).toBe(1);
	await first.dispose();
	await second.dispose();
	await rm(dir, { recursive: true, force: true });
});

test("an invalid person store does not disable machine collection", async () => {
	const dir = await mkdtemp(join(tmpdir(), "profile-independent-"));
	const privateDir = join(dir, "private");
	await mkdir(privateDir, { mode: 0o700 });
	const person = new PersonProfileService(join(privateDir, "user-profile.json"));
	await writeFile(person.path, "{}", { mode: 0o600 });
	const machine = new MachineProfileService(join(privateDir, "computer-profile.json"), async () => ({
		hostname: "synthetic-machine",
	}));
	const builder = new ProfileBuilder(person, machine, () => true);
	await builder.refresh();
	expect((await machine.get()).facts.hostname).toBe("synthetic-machine");
	expect(await person.status()).toMatchObject({ status: "invalid", reason: "unsupported_format" });
	await builder.dispose();
	await rm(dir, { recursive: true, force: true });
});
