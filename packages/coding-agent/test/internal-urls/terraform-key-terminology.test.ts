import { expect, test } from "bun:test";
import {
	preparePropertyScope,
	propertyQueryTerms,
	propertyTerms,
	rankPropertyScope,
} from "../../src/internal-urls/terraform-property-ranking";
import { selectPropertyDestination } from "../../src/internal-urls/terraform-property-selection";

test("primary and secondary key phrasing reaches existing schema abbreviations", () => {
	expect(propertyQueryTerms("Locate primary cookie HMAC key location")).toContain("prim");
	expect(propertyQueryTerms("Locate secondary cookie HMAC key location")).toContain("sec");
});
test("schema terms quoted literal spellings and dotted paths stay unchanged", () => {
	expect(propertyTerms("primary key")).not.toContain("prim");
	expect(propertyQueryTerms("Find `primary key`")).not.toContain("prim");
	expect(propertyQueryTerms("Find primary.key")).not.toContain("prim");
	expect(propertyQueryTerms("Find secondary_key")).not.toContain("sec");
	expect(propertyQueryTerms("Find primary school key")).not.toContain("prim");
});
test("key terminology separates supported identical field descriptions", () => {
	const rows = ["prim_key", "sec_key"].map(key => ({
		provider_type: "resources",
		provider_name: "fixture",
		schema_path: `cookie.auth_hmac.${key}.location`,
		path: key,
		anchor: "schema-location",
		description: "Encrypted secret location.",
		type: "string",
		flags: ["optional"],
	}));
	const query = "Which field specifies the primary HMAC key location?";
	const ranked = rankPropertyScope(query, preparePropertyScope(rows));
	expect(ranked[0]?.path).toBe("prim_key");
	expect(selectPropertyDestination(query, ranked).kind).toBe("leaf");
	const generic = rankPropertyScope("Which field specifies HMAC key location?", preparePropertyScope(rows));
	expect(selectPropertyDestination("Which field specifies HMAC key location?", generic).kind).toBe("choices");
});

test("key abbreviation normalization retains polarity and unrelated terminology", () => {
	expect(propertyQueryTerms("not primary HMAC key")).toContain("not");
	expect(propertyQueryTerms("primary key or secondary key")).toContain("or");
	expect(propertyQueryTerms("Find primary DNS server")).not.toContain("prim");
	expect(propertyQueryTerms("Find primary.key and secondary.key")).not.toContain("prim");
});

test("supported key expansion preserves descriptive words and database key meanings", () => {
	expect(propertyQueryTerms("primary HMAC key")).toContain("primary");
	expect(propertyQueryTerms("secondary cookie key")).toContain("secondary");
	expect(propertyQueryTerms("primary database key")).not.toContain("prim");
	expect(propertyQueryTerms("primary key")).not.toContain("prim");
});
