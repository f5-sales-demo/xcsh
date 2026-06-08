import { afterEach, describe, expect, it, vi } from "bun:test";
import {
	PROFILE_COLLECTORS,
	type ProfileCollector,
	registerProfileCollector,
	unregisterProfileCollector,
} from "../../src/internal-urls/profile-collectors";
import type { UserProfile } from "../../src/internal-urls/user-profile";
import { reconcileFromCollectors } from "../../src/internal-urls/user-profile";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockIOResult {
	lastWritten: () => UserProfile;
	writeCallCount: () => number;
}

function mockIO(initial: UserProfile = {}): MockIOResult {
	let captured = "";
	let writes = 0;

	vi.spyOn(Bun, "file").mockReturnValue({
		json: () => Promise.resolve(initial),
	} as unknown as ReturnType<typeof Bun.file>);

	vi.spyOn(Bun, "write").mockImplementation((async (_dest: unknown, data: unknown) => {
		captured = String(data);
		writes++;
		return captured.length;
	}) as typeof Bun.write);

	return {
		lastWritten: () => JSON.parse(captured) as UserProfile,
		writeCallCount: () => writes,
	};
}

function makeMockCollector(overrides: Partial<ProfileCollector> & { id: string }): ProfileCollector {
	return {
		name: overrides.id,
		available: async () => true,
		collect: async () => ({}),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// reconcileFromCollectors
// ---------------------------------------------------------------------------

const registeredIds: string[] = [];

function registerAndTrack(collector: ProfileCollector): void {
	registerProfileCollector(collector);
	registeredIds.push(collector.id);
}

describe("reconcileFromCollectors", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		for (const id of registeredIds) unregisterProfileCollector(id);
		registeredIds.length = 0;
	});

	it("runs a registered plugin collector and updates the profile", async () => {
		const io = mockIO({
			givenName: "Robin",
			manager: { givenName: "Paul", familyName: "Slosberg" },
		});

		// Suppress built-in system collector
		const systemCollector = PROFILE_COLLECTORS.find(c => c.id === "system");
		if (systemCollector) vi.spyOn(systemCollector, "available").mockResolvedValue(false);

		registerAndTrack(
			makeMockCollector({
				id: "test-salesforce",
				authoritativeFields: ["manager"],
				collect: async () => ({ manager: { givenName: "Kevin", familyName: "Reynolds" } }),
			}),
		);

		await reconcileFromCollectors();

		const written = io.lastWritten();
		expect(written.manager?.givenName).toBe("Kevin");
		expect(written.manager?.familyName).toBe("Reynolds");
		expect(written._fieldOwnership?.manager).toBe("test-salesforce");
	});

	it("authoritative collector overwrites pre-existing value with empty _fieldOwnership", async () => {
		const io = mockIO({
			manager: { givenName: "Paul", familyName: "Slosberg" },
			_fieldOwnership: {},
		});

		const systemCollector = PROFILE_COLLECTORS.find(c => c.id === "system");
		if (systemCollector) vi.spyOn(systemCollector, "available").mockResolvedValue(false);

		registerAndTrack(
			makeMockCollector({
				id: "test-sf-overwrite",
				authoritativeFields: ["manager", "territories"],
				collect: async () => ({
					manager: { givenName: "Kevin", familyName: "Reynolds" },
					territories: ["West", "Central"],
				}),
			}),
		);

		await reconcileFromCollectors();

		const written = io.lastWritten();
		expect(written.manager?.givenName).toBe("Kevin");
		expect(written.territories).toEqual(["West", "Central"]);
		expect(written._fieldOwnership?.manager).toBe("test-sf-overwrite");
		expect(written._fieldOwnership?.territories).toBe("test-sf-overwrite");
	});

	it("does not overwrite user-owned fields even with authoritative collector", async () => {
		const io = mockIO({
			role: "SE",
			_fieldOwnership: { role: "user" },
		});

		const systemCollector = PROFILE_COLLECTORS.find(c => c.id === "system");
		if (systemCollector) vi.spyOn(systemCollector, "available").mockResolvedValue(false);

		registerAndTrack(
			makeMockCollector({
				id: "test-sf-user-protect",
				authoritativeFields: ["role"],
				collect: async () => ({ role: "AE" }),
			}),
		);

		await reconcileFromCollectors();

		const written = io.lastWritten();
		expect(written.role).toBe("SE");
	});

	it("skips unavailable collectors", async () => {
		const io = mockIO({});

		const systemCollector = PROFILE_COLLECTORS.find(c => c.id === "system");
		if (systemCollector) vi.spyOn(systemCollector, "available").mockResolvedValue(false);

		registerAndTrack(
			makeMockCollector({
				id: "test-sf-unavailable",
				available: async () => false,
				collect: async () => ({ givenName: "Should Not Appear" }),
			}),
		);

		await reconcileFromCollectors();

		const written = io.lastWritten();
		expect(written.givenName).toBeUndefined();
		expect((written.sources as Record<string, string> | undefined)?.["test-sf-unavailable"]).toBeUndefined();
	});

	it("isolates a throwing collector — profile still saves", async () => {
		const io = mockIO({});

		const systemCollector = PROFILE_COLLECTORS.find(c => c.id === "system");
		if (systemCollector) vi.spyOn(systemCollector, "available").mockResolvedValue(false);

		registerAndTrack(
			makeMockCollector({
				id: "test-sf-throws",
				collect: async () => {
					throw new Error("SF CLI timeout");
				},
			}),
		);

		await reconcileFromCollectors();

		expect(io.writeCallCount()).toBe(1);
		const written = io.lastWritten();
		expect((written.sources as Record<string, string> | undefined)?.["test-sf-throws"]).toBeUndefined();
	});

	it("records source timestamp for successful collectors", async () => {
		mockIO({});

		const systemCollector = PROFILE_COLLECTORS.find(c => c.id === "system");
		if (systemCollector) vi.spyOn(systemCollector, "available").mockResolvedValue(false);

		registerAndTrack(
			makeMockCollector({
				id: "test-sf-timestamp",
				collect: async () => ({ jobTitle: "Engineer" }),
			}),
		);

		const before = Date.now();
		const result = await reconcileFromCollectors();
		const after = Date.now();

		const ts = new Date((result.sources as Record<string, string>)["test-sf-timestamp"]!).getTime();
		expect(ts).toBeGreaterThanOrEqual(before);
		expect(ts).toBeLessThanOrEqual(after);
	});

	it("non-authoritative collector does not overwrite existing values", async () => {
		const io = mockIO({
			givenName: "Robin",
		});

		const systemCollector = PROFILE_COLLECTORS.find(c => c.id === "system");
		if (systemCollector) vi.spyOn(systemCollector, "available").mockResolvedValue(false);

		registerAndTrack(
			makeMockCollector({
				id: "test-sf-no-auth",
				collect: async () => ({ givenName: "Robert" }),
			}),
		);

		await reconcileFromCollectors();

		const written = io.lastWritten();
		expect(written.givenName).toBe("Robin");
	});

	it("passes authoritativeFields through to reconcileProfile", async () => {
		const io = mockIO({
			manager: { givenName: "Old", familyName: "Manager" },
			givenName: "Robin",
		});

		const systemCollector = PROFILE_COLLECTORS.find(c => c.id === "system");
		if (systemCollector) vi.spyOn(systemCollector, "available").mockResolvedValue(false);

		registerAndTrack(
			makeMockCollector({
				id: "test-sf-selective-auth",
				authoritativeFields: ["manager"],
				collect: async () => ({
					manager: { givenName: "New", familyName: "Manager" },
					givenName: "Not Robin",
				}),
			}),
		);

		await reconcileFromCollectors();

		const written = io.lastWritten();
		expect(written.manager?.givenName).toBe("New");
		expect(written.givenName).toBe("Robin");
	});
});
