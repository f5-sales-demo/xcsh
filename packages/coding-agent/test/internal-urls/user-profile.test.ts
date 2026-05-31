import { afterEach, describe, expect, it, vi } from "bun:test";
import type { UserProfile } from "../../src/internal-urls/user-profile";
import { loadProfile, renderProfileMarkdown, saveProfile } from "../../src/internal-urls/user-profile";

// ---------------------------------------------------------------------------
// loadProfile / saveProfile
//
// PROFILE_PATH is a module-level const resolved from os.homedir().  Bun's
// os.homedir() ignores HOME env changes (uses getpwuid), so we cannot
// redirect it.  Instead we spy on Bun.file / Bun.write to intercept I/O.
// ---------------------------------------------------------------------------

describe("loadProfile", () => {
	afterEach(() => vi.restoreAllMocks());

	it("returns empty object when profile file does not exist", async () => {
		const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		vi.spyOn(Bun, "file").mockReturnValue({
			json: () => Promise.reject(enoent),
		} as unknown as ReturnType<typeof Bun.file>);

		const result = await loadProfile();
		expect(result).toEqual({});
	});

	it("returns parsed profile when file exists", async () => {
		const stored: UserProfile = { givenName: "Ada", email: "ada@example.com" };
		vi.spyOn(Bun, "file").mockReturnValue({
			json: () => Promise.resolve(stored),
		} as unknown as ReturnType<typeof Bun.file>);

		const result = await loadProfile();
		expect(result).toEqual(stored);
	});

	it("returns empty object on invalid JSON", async () => {
		vi.spyOn(Bun, "file").mockReturnValue({
			json: () => Promise.reject(new SyntaxError("Unexpected token")),
		} as unknown as ReturnType<typeof Bun.file>);

		const result = await loadProfile();
		expect(result).toEqual({});
	});
});

describe("saveProfile", () => {
	afterEach(() => vi.restoreAllMocks());

	it("writes profile to disk with updatedAt timestamp", async () => {
		let writtenPath = "";
		let writtenData = "";
		vi.spyOn(Bun, "write").mockImplementation((async (dest: string | URL, data: unknown) => {
			writtenPath = String(dest);
			writtenData = String(data);
			return writtenData.length;
		}) as typeof Bun.write);

		const profile: UserProfile = { givenName: "Grace", email: "grace@example.com" };
		await saveProfile(profile);

		expect(writtenPath).toContain("user-profile.json");
		const parsed = JSON.parse(writtenData) as UserProfile;
		expect(parsed.givenName).toBe("Grace");
		expect(parsed.email).toBe("grace@example.com");
		expect(parsed.updatedAt).toBeString();
		// Verify updatedAt is a valid ISO date within the last few seconds
		const ts = new Date(parsed.updatedAt!).getTime();
		expect(ts).toBeGreaterThan(Date.now() - 5000);
	});

	it("writes to the .xcsh directory under home", async () => {
		vi.spyOn(Bun, "write").mockImplementation((async (dest: string | URL) => {
			expect(String(dest)).toMatch(/\.xcsh[/\\]user-profile\.json$/);
			return 0;
		}) as unknown as typeof Bun.write);

		await saveProfile({ givenName: "Test" });
	});
});

// ---------------------------------------------------------------------------
// renderProfileMarkdown — pure function, no I/O mocking needed
// ---------------------------------------------------------------------------

describe("renderProfileMarkdown", () => {
	it("renders empty profile with seed instructions", () => {
		const md = renderProfileMarkdown({});
		expect(md).toContain("No profile data yet");
		expect(md).toContain("xcsh://user?seed=true");
	});

	it("renders populated profile with all sections", () => {
		const profile: UserProfile = {
			givenName: "Ada",
			familyName: "Lovelace",
			email: "ada@example.com",
			telephone: "+1-555-0100",
			image: "https://example.com/ada.jpg",
			jobTitle: "Engineer",
			department: "Computing",
			division: "R&D",
			worksFor: { name: "Babbage Inc", url: "https://babbage.io" },
			manager: { givenName: "Charles", familyName: "Babbage", email: "charles@babbage.io" },
			address: {
				streetAddress: "1 Engine Lane",
				addressLocality: "London",
				addressRegion: "England",
				postalCode: "EC1A 1BB",
				addressCountry: "UK",
			},
			birthDate: "1815-12-10",
			birthPlace: { addressLocality: "London", addressCountry: "UK" },
			nationality: "British",
			gender: "Female",
			knowsLanguage: ["English", "French"],
			spouse: { givenName: "William", familyName: "King" },
			children: [{ givenName: "Byron", birthDate: "1836-05-12" }],
			parent: [{ givenName: "Lord", familyName: "Byron" }],
			sibling: [{ givenName: "Elizabeth", familyName: "Medora" }],
			url: "https://ada.dev",
			description: "Mathematician and writer",
			identifiers: { github: "ada-lovelace", twitter: "ada_dev" },
			sameAs: ["https://linkedin.com/in/ada"],
			observations: [{ key: "preference", value: "dark-mode", source: "conversation", observedAt: "2026-01-01" }],
			sources: {
				github: "2026-01-01T00:00:00Z",
				system: "2026-01-01T00:00:00Z",
			},
			updatedAt: "2026-01-01T00:00:00Z",
		};

		const md = renderProfileMarkdown(profile);

		// All section headers present
		expect(md).toContain("## Identity");
		expect(md).toContain("## Employment");
		expect(md).toContain("## Address");
		expect(md).toContain("## Demographics");
		expect(md).toContain("## Family");
		expect(md).toContain("## Online Presence");
		expect(md).toContain("## Observations");

		// Spot-check content
		expect(md).toContain("Ada");
		expect(md).toContain("Lovelace");
		expect(md).toContain("ada@example.com");
		expect(md).toContain("Engineer");
		expect(md).toContain("[Babbage Inc](https://babbage.io)");
		expect(md).toContain("London");
		expect(md).toContain("British");
		expect(md).toContain("William");
		expect(md).toContain("Byron");
		expect(md).toContain("ada-lovelace");
		expect(md).toContain("dark-mode");
	});

	it("skips empty sections", () => {
		const profile: UserProfile = {
			givenName: "Minimal",
			email: "min@example.com",
		};

		const md = renderProfileMarkdown(profile);

		expect(md).toContain("## Identity");
		expect(md).toContain("Minimal");
		expect(md).toContain("min@example.com");

		// These sections should not appear
		expect(md).not.toContain("## Demographics");
		expect(md).not.toContain("## Family");
		expect(md).not.toContain("## Address");
		expect(md).not.toContain("## Observations");
	});

	it("renders observations as a table", () => {
		const profile: UserProfile = {
			givenName: "Tester",
			observations: [
				{ key: "tz", value: "America/Toronto", source: "system", observedAt: "2026-03-15" },
				{ key: "editor", value: "vim" },
			],
		};

		const md = renderProfileMarkdown(profile);

		expect(md).toContain("| Key | Value | Source | Observed |");
		expect(md).toContain("|-----|-------|--------|----------|");
		expect(md).toContain("| tz | America/Toronto | system | 2026-03-15 |");
		expect(md).toContain("| editor | vim |  |  |");
	});

	it("renders sources footer", () => {
		const profile: UserProfile = {
			givenName: "Tester",
			sources: {
				github: "2026-02-01T00:00:00Z",
				system: "2026-03-01T00:00:00Z",
			},
			updatedAt: "2026-03-01T00:00:00Z",
		};

		const md = renderProfileMarkdown(profile);

		expect(md).toContain("**Sources:**");
		expect(md).toContain("GitHub:");
		expect(md).toContain("System:");
		expect(md).toContain("*Last updated:");
	});
});

describe("renderProfileMarkdown — demographics", () => {
	it("renders birthDate under Demographics", () => {
		const profile: UserProfile = { givenName: "Alex", birthDate: "1971-02-12" };
		const md = renderProfileMarkdown(profile);
		expect(md).toContain("## Demographics");
		expect(md).toContain("**Birth Date:** 1971-02-12");
	});

	it("renders birthPlace under Demographics", () => {
		const profile: UserProfile = {
			givenName: "Alex",
			birthPlace: { addressLocality: "Regina", addressRegion: "Saskatchewan", addressCountry: "Canada" },
		};
		const md = renderProfileMarkdown(profile);
		expect(md).toContain("## Demographics");
		expect(md).toContain("**Birth Place:** Regina, Saskatchewan, Canada");
	});

	it("includes additionalName (middle name) in full name", () => {
		const profile: UserProfile = {
			givenName: "Alex",
			additionalName: "Jean",
			familyName: "Doe",
			email: "test@example.com",
		};
		const md = renderProfileMarkdown(profile);
		expect(md).toContain("Alex Jean Doe");
	});

	it("renders worksFor without URL as plain text", () => {
		const profile: UserProfile = { givenName: "Test", worksFor: { name: "F5" } };
		const md = renderProfileMarkdown(profile);
		expect(md).toContain("**Organization:** F5");
		expect(md).not.toContain("[F5]");
	});

	it("renders manager name without parentheses when email absent", () => {
		const profile: UserProfile = {
			givenName: "Test",
			manager: { givenName: "Jane", familyName: "Manager" },
		};
		const md = renderProfileMarkdown(profile);
		expect(md).toContain("**Manager:** Jane Manager");
		expect(md).not.toContain("Jane Manager (");
	});
});
