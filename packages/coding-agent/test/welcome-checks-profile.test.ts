import { afterEach, describe, expect, it, vi } from "bun:test";
import { checkProfileStatus } from "../src/modes/components/welcome-checks";

// Mock Bun.file to control profile data without touching ~/.xcsh/user-profile.json
function mockProfile(data: object): void {
	vi.spyOn(Bun, "file").mockReturnValue({
		json: () => Promise.resolve(data),
	} as unknown as ReturnType<typeof Bun.file>);
}

function mockProfileMissing(): void {
	vi.spyOn(Bun, "file").mockReturnValue({
		json: () => Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" })),
	} as unknown as ReturnType<typeof Bun.file>);
}

describe("checkProfileStatus", () => {
	afterEach(() => vi.restoreAllMocks());

	it("returns current when profile is fresh (updatedAt within 24h)", async () => {
		const recentTs = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago
		mockProfile({ givenName: "Ada", familyName: "Lovelace", updatedAt: recentTs });

		const result = await checkProfileStatus();
		expect(result?.state).toBe("current");
		expect(result?.name).toBe("Ada Lovelace");
		expect(result?.updatedAt).toBe(recentTs);
	});

	it("returns stale when updatedAt is older than 24h", async () => {
		const oldTs = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString(); // 50h ago
		mockProfile({ givenName: "Ada", familyName: "Lovelace", updatedAt: oldTs });

		const result = await checkProfileStatus();
		expect(result?.state).toBe("stale");
		expect(result?.name).toBe("Ada Lovelace");
		expect(result?.staleDays).toBe(2);
	});

	it("returns stale when updatedAt is absent", async () => {
		mockProfile({ givenName: "Ada", familyName: "Lovelace" });

		const result = await checkProfileStatus();
		expect(result?.state).toBe("stale");
		expect(result?.name).toBe("Ada Lovelace");
		expect(result?.staleDays).toBeUndefined();
	});

	it("returns missing when profile file does not exist", async () => {
		mockProfileMissing();

		const result = await checkProfileStatus();
		expect(result?.state).toBe("missing");
	});

	it("returns missing when profile has no name fields", async () => {
		const recentTs = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
		mockProfile({ jobTitle: "Engineer", updatedAt: recentTs });

		const result = await checkProfileStatus();
		expect(result?.state).toBe("missing");
	});

	it("builds name from givenName only when familyName is absent", async () => {
		const recentTs = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
		mockProfile({ givenName: "Ada", updatedAt: recentTs });

		const result = await checkProfileStatus();
		expect(result?.state).toBe("current");
		expect(result?.name).toBe("Ada");
	});

	it("builds name from familyName only when givenName is absent", async () => {
		const recentTs = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
		mockProfile({ familyName: "Lovelace", updatedAt: recentTs });

		const result = await checkProfileStatus();
		expect(result?.state).toBe("current");
		expect(result?.name).toBe("Lovelace");
	});
});
