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

/** Force every collector unavailable so tests stay hermetic (no real CLI shell-outs). */
function disableAllCollectors(): void {
	for (const c of PROFILE_COLLECTORS) {
		vi.spyOn(c, "available").mockResolvedValue(false);
	}
}

// ---------------------------------------------------------------------------
// seedProfile
// ---------------------------------------------------------------------------

describe("seedProfile", () => {
	afterEach(() => vi.restoreAllMocks());

	it("skips unavailable collectors and omits their source timestamp", async () => {
		const io = mockIO();
		disableAllCollectors();

		const { profile } = await seedProfile();

		expect(profile.sources?.system).toBeUndefined();
		expect(io.lastWritten().sources?.system).toBeUndefined();
	});

	it("isolates a throwing collector — others still run and profile saves", async () => {
		const io = mockIO();
		disableAllCollectors();

		vi.spyOn(collector("system"), "available").mockResolvedValue(true);
		vi.spyOn(collector("system"), "collect").mockResolvedValue({ knowsLanguage: ["en-US"] });

		await seedProfile();

		const written = io.lastWritten();
		expect(written.sources?.system).toBeString();
		expect(written.knowsLanguage).toEqual(["en-US"]);
	});

	it("records source timestamps within the call window", async () => {
		mockIO();
		disableAllCollectors();

		vi.spyOn(collector("system"), "available").mockResolvedValue(true);
		vi.spyOn(collector("system"), "collect").mockResolvedValue({});

		const before = Date.now();
		const { profile } = await seedProfile();
		const after = Date.now();

		const ts = new Date(profile.sources!.system!).getTime();
		expect(ts).toBeGreaterThanOrEqual(before);
		expect(ts).toBeLessThanOrEqual(after);
	});

	it("saves profile to disk exactly once", async () => {
		const io = mockIO();
		disableAllCollectors();

		await seedProfile();

		expect(io.writeCallCount()).toBe(1);
	});

	// -----------------------------------------------------------------------
	// New: seed populates identity fields and reports per-collector outcome
	// -----------------------------------------------------------------------

	it("populates identity fields from an available collector", async () => {
		mockIO();
		disableAllCollectors();

		vi.spyOn(collector("git"), "available").mockResolvedValue(true);
		vi.spyOn(collector("git"), "collect").mockResolvedValue({
			givenName: "Ada",
			familyName: "Lovelace",
			email: "ada@example.com",
		});

		const { profile } = await seedProfile();

		expect(profile.givenName).toBe("Ada");
		expect(profile.familyName).toBe("Lovelace");
		expect(profile.email).toBe("ada@example.com");
	});

	it("returns a per-collector results report (collected / unavailable / error)", async () => {
		mockIO();
		disableAllCollectors();

		vi.spyOn(collector("git"), "available").mockResolvedValue(true);
		vi.spyOn(collector("git"), "collect").mockResolvedValue({ givenName: "Ada" });

		vi.spyOn(collector("github"), "available").mockResolvedValue(true);
		vi.spyOn(collector("github"), "collect").mockRejectedValue(new Error("gh exploded"));

		const { results } = await seedProfile();

		const byId = Object.fromEntries(results.map(r => [r.id, r]));
		expect(byId.git.status).toBe("collected");
		expect(byId.git.fields).toContain("givenName");
		expect(byId.github.status).toBe("error");
		expect(byId.github.error).toContain("gh exploded");
		expect(byId.system.status).toBe("unavailable");
	});
});
