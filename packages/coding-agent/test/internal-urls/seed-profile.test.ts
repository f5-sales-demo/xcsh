import { afterEach, describe, expect, it, vi } from "bun:test";
import { PROFILE_COLLECTORS } from "../../src/internal-urls/profile-collectors";
import type { UserProfile } from "../../src/internal-urls/user-profile";
import { seedProfile } from "../../src/internal-urls/user-profile";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockIOResult {
	lastWritten: () => UserProfile;
	writeCallCount: () => number;
}

function mockIO(initial: object = {}): MockIOResult {
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

function collector(id: string) {
	const c = PROFILE_COLLECTORS.find(p => p.id === id);
	if (!c) throw new Error(`unknown collector: ${id}`);
	return c;
}

// ---------------------------------------------------------------------------
// seedProfile
// ---------------------------------------------------------------------------

describe("seedProfile", () => {
	afterEach(() => vi.restoreAllMocks());

	it("skips unavailable collectors and omits their source timestamp", async () => {
		const io = mockIO();

		vi.spyOn(collector("github"), "available").mockResolvedValue(true);
		vi.spyOn(collector("github"), "collect").mockResolvedValue({ givenName: "Alex" });

		vi.spyOn(collector("system"), "available").mockResolvedValue(false);

		await seedProfile();

		const written = io.lastWritten();
		expect(written.sources?.github).toBeString();
		expect(written.sources?.system).toBeUndefined();
	});

	it("isolates a throwing collector — others still run and profile saves", async () => {
		const io = mockIO();

		vi.spyOn(collector("github"), "available").mockResolvedValue(true);
		vi.spyOn(collector("github"), "collect").mockRejectedValue(new Error("gh exploded"));

		vi.spyOn(collector("system"), "available").mockResolvedValue(true);
		vi.spyOn(collector("system"), "collect").mockResolvedValue({ knowsLanguage: ["en-US"] });

		await seedProfile();

		const written = io.lastWritten();
		expect(written.sources?.github).toBeUndefined();
		expect(written.sources?.system).toBeString();
		expect(written.knowsLanguage).toEqual(["en-US"]);
	});

	it("records source timestamps within the call window", async () => {
		mockIO();

		vi.spyOn(collector("github"), "available").mockResolvedValue(true);
		vi.spyOn(collector("github"), "collect").mockResolvedValue({});

		vi.spyOn(collector("system"), "available").mockResolvedValue(true);
		vi.spyOn(collector("system"), "collect").mockResolvedValue({});

		const before = Date.now();
		const result = await seedProfile();
		const after = Date.now();

		for (const id of ["github", "system"] as const) {
			const ts = new Date(result.sources![id]!).getTime();
			expect(ts).toBeGreaterThanOrEqual(before);
			expect(ts).toBeLessThanOrEqual(after);
		}
	});

	it("saves profile to disk exactly once", async () => {
		const io = mockIO();

		vi.spyOn(collector("github"), "available").mockResolvedValue(false);
		vi.spyOn(collector("system"), "available").mockResolvedValue(false);

		await seedProfile();

		expect(io.writeCallCount()).toBe(1);
	});

	it("does not overwrite existing profile fields with collector data", async () => {
		const io = mockIO({ givenName: "Alex", email: "test@example.com" });

		vi.spyOn(collector("github"), "available").mockResolvedValue(true);
		vi.spyOn(collector("github"), "collect").mockResolvedValue({
			email: "other@gh.com",
			description: "A developer",
		});

		vi.spyOn(collector("system"), "available").mockResolvedValue(false);

		await seedProfile();

		const written = io.lastWritten();
		expect(written.email).toBe("test@example.com");
		expect(written.description).toBe("A developer");
	});
});
