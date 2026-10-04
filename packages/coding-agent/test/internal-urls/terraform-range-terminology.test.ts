import { expect, test } from "bun:test";
import { propertyQueryTerms, propertyTerms } from "../../src/internal-urls/terraform-property-ranking";

test("ordinary beginning wording retains original evidence and reaches start", () => {
	expect(propertyQueryTerms("Find the beginning of an address range")).toEqual(
		expect.arrayContaining(["beginning", "start", "address", "range"]),
	);
});
test("quoted literal and exact schema path spellings retain their terms", () => {
	expect(propertyQueryTerms("Find `beginning`")).not.toContain("start");
	expect(propertyQueryTerms("Find beginning.address")).not.toContain("start");
	expect(propertyTerms("beginning")).not.toContain("start");
});
test("lexical expansion does not infer an IP field or overwrite polarity", () => {
	expect(propertyQueryTerms("beginning of a server pool")).not.toContain("ip");
	expect(propertyQueryTerms("not the beginning of a DHCP range")).toContain("not");
	expect(propertyQueryTerms("beginning of an address range")).not.toContain("ip");
});
