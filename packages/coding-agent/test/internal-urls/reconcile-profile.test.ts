import { describe, expect, it } from "bun:test";
import { reconcileProfile, type UserProfile } from "../../src/internal-urls/user-profile";

describe("reconcileProfile", () => {
	describe("empty fields (no ownership)", () => {
		it("fills empty field and claims ownership", () => {
			const target: UserProfile = {};
			reconcileProfile(target, { givenName: "Robin" }, "salesforce");
			expect(target.givenName).toBe("Robin");
			expect(target._fieldOwnership?.givenName).toBe("salesforce");
		});

		it("fills manager object on empty profile", () => {
			const target: UserProfile = {};
			reconcileProfile(target, { manager: { givenName: "Kevin", familyName: "Reynolds" } }, "salesforce");
			expect(target.manager?.givenName).toBe("Kevin");
			expect(target.manager?.familyName).toBe("Reynolds");
			expect(target._fieldOwnership?.manager).toBe("salesforce");
		});

		it("fills territories array on empty profile", () => {
			const target: UserProfile = {};
			reconcileProfile(target, { territories: ["West", "Central"] }, "salesforce");
			expect(target.territories).toEqual(["West", "Central"]);
			expect(target._fieldOwnership?.territories).toBe("salesforce");
		});
	});

	describe("source-of-truth overwrites", () => {
		it("overwrites field owned by the same source", () => {
			const target: UserProfile = {
				manager: { givenName: "Paul", familyName: "Slosberg" },
				_fieldOwnership: { manager: "salesforce" },
			};
			reconcileProfile(target, { manager: { givenName: "Kevin", familyName: "Reynolds" } }, "salesforce");
			expect(target.manager?.givenName).toBe("Kevin");
			expect(target.manager?.familyName).toBe("Reynolds");
		});

		it("overwrites scalar field owned by the same source", () => {
			const target: UserProfile = {
				jobTitle: "Solutions Engineer",
				_fieldOwnership: { jobTitle: "salesforce" },
			};
			reconcileProfile(target, { jobTitle: "Sr Solutions Engineer" }, "salesforce");
			expect(target.jobTitle).toBe("Sr Solutions Engineer");
		});
	});

	describe("user-authored protection", () => {
		it("skips field explicitly owned by user", () => {
			const target: UserProfile = {
				role: "SE",
				_fieldOwnership: { role: "user" },
			};
			reconcileProfile(target, { role: "AE" }, "salesforce");
			expect(target.role).toBe("SE");
		});

		it("skips field with no ownership and existing value (implicit user-authored)", () => {
			const target: UserProfile = { givenName: "Robin" };
			reconcileProfile(target, { givenName: "Robert" }, "salesforce");
			expect(target.givenName).toBe("Robin");
		});
	});

	describe("cross-source conflict", () => {
		it("skips field owned by a different source", () => {
			const target: UserProfile = {
				knowsLanguage: ["en-US"],
				_fieldOwnership: { knowsLanguage: "system" },
			};
			reconcileProfile(target, { knowsLanguage: ["fr-FR"] }, "salesforce");
			expect(target.knowsLanguage).toEqual(["en-US"]);
		});
	});

	describe("authoritative fields", () => {
		it("overwrites pre-existing value with no ownership when field is authoritative", () => {
			const target: UserProfile = {
				manager: { givenName: "Paul", familyName: "Slosberg" },
			};
			const authoritative = new Set(["manager"]);
			reconcileProfile(
				target,
				{ manager: { givenName: "Kevin", familyName: "Reynolds" } },
				"salesforce",
				authoritative,
			);
			expect(target.manager?.givenName).toBe("Kevin");
			expect(target.manager?.familyName).toBe("Reynolds");
			expect(target._fieldOwnership?.manager).toBe("salesforce");
		});

		it("still respects explicit user ownership even for authoritative fields", () => {
			const target: UserProfile = {
				role: "SE",
				_fieldOwnership: { role: "user" },
			};
			const authoritative = new Set(["role"]);
			reconcileProfile(target, { role: "AE" }, "salesforce", authoritative);
			expect(target.role).toBe("SE");
		});

		it("does not overwrite non-authoritative fields with existing values", () => {
			const target: UserProfile = {
				givenName: "Robin",
				manager: { givenName: "Paul", familyName: "Slosberg" },
			};
			const authoritative = new Set(["manager"]);
			reconcileProfile(
				target,
				{ givenName: "Robert", manager: { givenName: "Kevin", familyName: "Reynolds" } },
				"salesforce",
				authoritative,
			);
			expect(target.givenName).toBe("Robin");
			expect(target.manager?.givenName).toBe("Kevin");
		});
	});

	describe("meta fields and security", () => {
		it("skips _fieldOwnership in source", () => {
			const target: UserProfile = {};
			reconcileProfile(target, { _fieldOwnership: { givenName: "attacker" } } as Partial<UserProfile>, "evil");
			expect(target._fieldOwnership).toEqual({});
		});

		it("skips sources in source", () => {
			const target: UserProfile = {};
			reconcileProfile(target, { sources: { github: "2024-01-01" } }, "salesforce");
			expect(target.sources).toBeUndefined();
		});

		it("skips __proto__ key", () => {
			const target: UserProfile = {};
			const source = JSON.parse('{"__proto__": {"polluted": true}, "givenName": "Ada"}');
			reconcileProfile(target, source, "salesforce");
			expect(target.givenName).toBe("Ada");
			expect(({} as any).polluted).toBeUndefined();
		});

		it("skips constructor key", () => {
			const target: UserProfile = {};
			const source = { constructor: "bad" } as unknown as Partial<UserProfile>;
			reconcileProfile(target, source, "salesforce");
			expect(typeof target.constructor).toBe("function");
		});
	});
});
