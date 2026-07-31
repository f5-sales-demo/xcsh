import { describe, expect, it } from "bun:test";
import type { ProfileCollector } from "../../src/internal-urls/profile-collectors";
import {
	PROFILE_COLLECTORS,
	parseGithubUserJson,
	parseSalesforceUserRecord,
	runCli,
	splitFullName,
} from "../../src/internal-urls/profile-collectors";

describe("PROFILE_COLLECTORS registry", () => {
	it("exports a non-empty readonly array", () => {
		expect(Array.isArray(PROFILE_COLLECTORS)).toBe(true);
		expect(PROFILE_COLLECTORS.length).toBeGreaterThanOrEqual(1);
	});

	it("each collector has required interface fields", () => {
		for (const collector of PROFILE_COLLECTORS) {
			expect(typeof collector.id).toBe("string");
			expect(collector.id.length).toBeGreaterThan(0);
			expect(typeof collector.name).toBe("string");
			expect(collector.name.length).toBeGreaterThan(0);
			expect(typeof collector.available).toBe("function");
			expect(typeof collector.collect).toBe("function");
		}
	});

	it("collector ids are unique", () => {
		const ids = PROFILE_COLLECTORS.map((c: ProfileCollector) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("registers salesforce, github, git, and system identity collectors", () => {
		const ids = PROFILE_COLLECTORS.map((c: ProfileCollector) => c.id);
		expect(ids).toContain("salesforce");
		expect(ids).toContain("github");
		expect(ids).toContain("git");
		expect(ids).toContain("system");
	});

	it("orders salesforce → github → git → system so higher-trust sources win scalar merges", () => {
		const ids = PROFILE_COLLECTORS.map((c: ProfileCollector) => c.id);
		expect(ids.indexOf("salesforce")).toBeLessThan(ids.indexOf("github"));
		expect(ids.indexOf("github")).toBeLessThan(ids.indexOf("git"));
		expect(ids.indexOf("git")).toBeLessThan(ids.indexOf("system"));
	});

	it("marks salesforce as authoritative for corporate identity fields", () => {
		const sf = PROFILE_COLLECTORS.find((c: ProfileCollector) => c.id === "salesforce");
		expect(sf?.authoritativeFields).toBeDefined();
		expect(sf?.authoritativeFields).toContain("jobTitle");
	});
});

describe("ProfileCollector interface contract", () => {
	it("available() returns a boolean for each collector", async () => {
		const results = await Promise.all(
			PROFILE_COLLECTORS.map(async (c: ProfileCollector) => {
				const result = await c.available();
				return { id: c.id, result };
			}),
		);
		for (const { result } of results) {
			expect(typeof result).toBe("boolean");
		}
	}, 30_000);

	it("collect() returns an object for available collectors", async () => {
		const availability = await Promise.all(
			PROFILE_COLLECTORS.map(async (c: ProfileCollector) => ({
				collector: c,
				available: await c.available(),
			})),
		);
		const collectResults = await Promise.all(
			availability
				.filter(a => a.available)
				.map(async a => {
					const result = await a.collector.collect();
					return { id: a.collector.id, result };
				}),
		);
		for (const { result } of collectResults) {
			expect(result).toBeDefined();
			expect(typeof result).toBe("object");
			expect(result).not.toBeNull();
		}
	}, 30_000);
});

// ---------------------------------------------------------------------------
// runCli — bounded, killable CLI shell-out
// ---------------------------------------------------------------------------

describe("runCli", () => {
	it("returns stdout and exit code 0 for a fast command", async () => {
		const { exitCode, stdout } = await runCli(["echo", "hello"]);
		expect(exitCode).toBe(0);
		expect(stdout.trim()).toBe("hello");
	});

	it("reports a non-zero exit code without throwing", async () => {
		const { exitCode } = await runCli(["false"]);
		expect(exitCode).not.toBe(0);
	});

	it("kills a hanging command at the timeout instead of pending forever", async () => {
		const start = Date.now();
		const { exitCode } = await runCli(["sleep", "10"], 300);
		const elapsed = Date.now() - start;
		// Bounded well under the 10s natural duration.
		expect(elapsed).toBeLessThan(3000);
		expect(exitCode).not.toBe(0);
	});
});

// ---------------------------------------------------------------------------
// splitFullName — shared name-splitting helper
// ---------------------------------------------------------------------------

describe("splitFullName", () => {
	it("splits a two-part name into given + family", () => {
		expect(splitFullName("Ada Lovelace")).toEqual({ givenName: "Ada", familyName: "Lovelace" });
	});

	it("keeps everything after the first token as the family name", () => {
		expect(splitFullName("Ada B Lovelace")).toEqual({ givenName: "Ada", familyName: "B Lovelace" });
	});

	it("returns only givenName for a single-token name", () => {
		expect(splitFullName("Cher")).toEqual({ givenName: "Cher" });
	});

	it("returns empty object for blank input", () => {
		expect(splitFullName("")).toEqual({});
		expect(splitFullName("   ")).toEqual({});
	});
});

// ---------------------------------------------------------------------------
// parseGithubUserJson — maps `gh api user` output
// ---------------------------------------------------------------------------

describe("parseGithubUserJson", () => {
	it("maps login, name, email, bio, blog, and twitter", () => {
		const stdout = JSON.stringify({
			login: "ada-lovelace",
			name: "Ada Lovelace",
			email: "ada@example.com",
			bio: "Mathematician",
			blog: "https://ada.dev",
			twitter_username: "ada_dev",
		});

		const p = parseGithubUserJson(stdout);

		expect(p.identifiers?.github).toBe("ada-lovelace");
		expect(p.givenName).toBe("Ada");
		expect(p.familyName).toBe("Lovelace");
		expect(p.email).toBe("ada@example.com");
		expect(p.description).toBe("Mathematician");
		expect(p.url).toBe("https://ada.dev");
		expect(p.identifiers?.twitter).toBe("ada_dev");
		expect(p.sameAs).toContain("https://github.com/ada-lovelace");
		expect(p.sameAs).toContain("https://x.com/ada_dev");
	});

	it("returns empty object on malformed JSON", () => {
		expect(parseGithubUserJson("not json")).toEqual({});
	});

	it("omits fields that are absent", () => {
		const p = parseGithubUserJson(JSON.stringify({ login: "solo" }));
		expect(p.identifiers?.github).toBe("solo");
		expect(p.email).toBeUndefined();
		expect(p.givenName).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// parseSalesforceUserRecord — maps a User SOQL record
// ---------------------------------------------------------------------------

describe("parseSalesforceUserRecord", () => {
	it("maps identity, employment, manager, and address fields", () => {
		const rec = {
			Id: "005000000000001",
			FirstName: "Dana",
			LastName: "Rivera",
			Email: "dana@example.com",
			Title: "Solutions Engineer",
			Department: "Sales",
			Division: "Americas",
			CompanyName: "F5",
			Manager: { Name: "Jane Boss", Email: "jane@example.com" },
			Street: "1 Main St",
			City: "Toronto",
			State: "ON",
			PostalCode: "M1A1A1",
			Country: "Canada",
			Phone: "+1-555-0100",
		};

		const p = parseSalesforceUserRecord(rec);

		expect(p.givenName).toBe("Dana");
		expect(p.familyName).toBe("Rivera");
		expect(p.email).toBe("dana@example.com");
		expect(p.jobTitle).toBe("Solutions Engineer");
		expect(p.department).toBe("Sales");
		expect(p.division).toBe("Americas");
		expect(p.worksFor?.name).toBe("F5");
		expect(p.manager?.givenName).toBe("Jane");
		expect(p.manager?.familyName).toBe("Boss");
		expect(p.manager?.email).toBe("jane@example.com");
		expect(p.address?.addressLocality).toBe("Toronto");
		expect(p.address?.addressCountry).toBe("Canada");
		expect(p.telephone).toBe("+1-555-0100");
		expect(p.identifiers?.salesforceId).toBe("005000000000001");
	});

	it("defaults organization to F5 when CompanyName is absent", () => {
		const p = parseSalesforceUserRecord({ FirstName: "A", LastName: "B" });
		expect(p.worksFor?.name).toBe("F5");
	});
});
