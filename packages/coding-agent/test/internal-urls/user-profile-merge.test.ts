import { describe, expect, it } from "bun:test";
import { mergeProfile, type UserProfile } from "../../src/internal-urls/user-profile";

describe("mergeProfile", () => {
	describe("scalar fields", () => {
		it("sets givenName when target is empty", () => {
			const target: UserProfile = {};
			mergeProfile(target, { givenName: "Ada" });
			expect(target.givenName).toBe("Ada");
		});

		it("does not overwrite existing givenName", () => {
			const target: UserProfile = { givenName: "Ada" };
			mergeProfile(target, { givenName: "Grace" });
			expect(target.givenName).toBe("Ada");
		});

		it("skips null source values", () => {
			const target: UserProfile = {};
			mergeProfile(target, { givenName: null as unknown as string });
			expect(target.givenName).toBeUndefined();
		});

		it("skips undefined source values", () => {
			const target: UserProfile = {};
			mergeProfile(target, { givenName: undefined });
			expect(target.givenName).toBeUndefined();
		});
	});

	describe("sameAs array", () => {
		it("initializes when target has none", () => {
			const target: UserProfile = {};
			mergeProfile(target, { sameAs: ["https://github.com/ada"] });
			expect(target.sameAs).toEqual(["https://github.com/ada"]);
		});

		it("appends new URLs to existing array", () => {
			const target: UserProfile = { sameAs: ["https://github.com/ada"] };
			mergeProfile(target, { sameAs: ["https://twitter.com/ada"] });
			expect(target.sameAs).toContain("https://github.com/ada");
			expect(target.sameAs).toContain("https://twitter.com/ada");
			expect(target.sameAs).toHaveLength(2);
		});

		it("deduplicates URLs already present", () => {
			const url = "https://github.com/ada";
			const target: UserProfile = { sameAs: [url] };
			mergeProfile(target, { sameAs: [url, url] });
			expect(target.sameAs?.filter(u => u === url)).toHaveLength(1);
			expect(target.sameAs).toHaveLength(1);
		});
	});

	describe("knowsLanguage", () => {
		it("sets when target has none", () => {
			const target: UserProfile = {};
			mergeProfile(target, { knowsLanguage: ["en", "fr"] });
			expect(target.knowsLanguage).toEqual(["en", "fr"]);
		});

		it("does not overwrite existing array", () => {
			const target: UserProfile = { knowsLanguage: ["en"] };
			mergeProfile(target, { knowsLanguage: ["fr", "de"] });
			expect(target.knowsLanguage).toEqual(["en"]);
		});
	});

	describe("object fields (first-writer-wins)", () => {
		it("sets address when target has none", () => {
			const target: UserProfile = {};
			mergeProfile(target, { address: { addressLocality: "Seattle", addressRegion: "WA" } });
			expect(target.address?.addressLocality).toBe("Seattle");
		});

		it("does not overwrite existing address", () => {
			const target: UserProfile = { address: { addressLocality: "Portland" } };
			mergeProfile(target, { address: { addressLocality: "Seattle" } });
			expect(target.address?.addressLocality).toBe("Portland");
		});

		it("sets worksFor when target has none", () => {
			const target: UserProfile = {};
			mergeProfile(target, { worksFor: { name: "F5", url: "https://f5.com" } });
			expect(target.worksFor?.name).toBe("F5");
		});

		it("does not overwrite existing worksFor", () => {
			const target: UserProfile = { worksFor: { name: "Acme" } };
			mergeProfile(target, { worksFor: { name: "F5" } });
			expect(target.worksFor?.name).toBe("Acme");
		});

		it("sets birthPlace when target has none", () => {
			const target: UserProfile = {};
			mergeProfile(target, { birthPlace: { addressLocality: "London", addressRegion: "England" } });
			expect(target.birthPlace?.addressLocality).toBe("London");
			expect(target.birthPlace?.addressRegion).toBe("England");
		});
	});

	describe("protected keys", () => {
		it("sources is never copied from source", () => {
			const target: UserProfile = {};
			mergeProfile(target, { sources: { github: "2024-01-01T00:00:00.000Z" } });
			expect(target.sources).toBeUndefined();
		});

		it("observations is never copied from source", () => {
			const target: UserProfile = {};
			mergeProfile(target, { observations: [{ key: "foo", value: "bar" }] });
			expect(target.observations).toBeUndefined();
		});

		it("updatedAt is never copied from source", () => {
			const target: UserProfile = {};
			mergeProfile(target, { updatedAt: "2024-01-01T00:00:00.000Z" });
			expect(target.updatedAt).toBeUndefined();
		});
	});
});
