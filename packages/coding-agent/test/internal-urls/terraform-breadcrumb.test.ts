import { expect, test } from "bun:test";
import {
	propertyBreadcrumbText,
	propertyExplicitSchemaPaths,
	propertyQueryTerms,
	propertyRequestedText,
} from "../../src/internal-urls/terraform-property-ranking";

test("explicit schema breadcrumbs retain adjacency and negation", () => {
	expect(propertyExplicitSchemaPaths("under service > advertise_options > https > certificates, find name")).toEqual([
		"service.advertise_options.https.certificates",
	]);
	expect(propertyExplicitSchemaPaths("not under service > https > certificates, find name")).toEqual([]);
	expect(propertyBreadcrumbText("under tls > custom_security")).toBe("under tls.custom_security");
});

test("complete schema scope survives contextual sentence positions", () => {
	for (const prefix of ["at", "uses", "inspecting", "concerns", "Context: managed resource;"])
		expect(propertyExplicitSchemaPaths(`${prefix} service > tls > certificates. Field name`)).toEqual([
			"service.tls.certificates",
		]);
	expect(propertyExplicitSchemaPaths("not at service > tls > certificates. Field name")).toEqual([]);
});

test("explicit quoted field labels retain exact scalar identity", () => {
	expect(propertyRequestedText("What namespace does this reference use? Field: `namespace`.")).toBe("namespace");
	expect(propertyRequestedText("How is this match inverted? Field: `not`.")).toBe("not");
	expect(propertyRequestedText("Field: `name`. Field: `namespace`.")).not.toBe("name");
});

test("rejected field labels do not become an explicit target", () => {
	expect(propertyRequestedText("Not field: `name`. Find namespace")).not.toBe("name");
	expect(propertyRequestedText("Example field: `name`. Find namespace")).not.toBe("name");
});

test("single labeled schema branch is explicit scope", () => {
	expect(propertyExplicitSchemaPaths("at virtual_host: Which name? Field: `name`.")).toEqual(["virtual_host"]);
	expect(propertyExplicitSchemaPaths("inspecting details on the data source. Field: `severity`.")).toEqual([
		"details",
	]);
	expect(propertyExplicitSchemaPaths("under root. Field: `name`.")).toEqual([]);
});

test("single scope extraction never consumes dotted context prefixes", () => {
	expect(propertyExplicitSchemaPaths("Context: resource; service > tls > certificates. Field: `name`.")).toEqual([
		"service.tls.certificates",
	]);
	expect(propertyExplicitSchemaPaths("not at virtual_host: Field: `name`.")).toEqual([]);
});

test("article before named schema branch is preserved", () => {
	expect(propertyExplicitSchemaPaths("My data source uses the certificate_chain branch. Field: `name`.")).toEqual([
		"certificate_chain",
	]);
});

test("quoted field in a contract lookup is the requested value", () => {
	expect(propertyRequestedText("Explain the type and restrictions of `decryption_provider`.")).toBe(
		"decryption_provider",
	);
	expect(propertyRequestedText("I need to understand `prefixes` in Terraform.")).toBe("prefixes");
	expect(propertyRequestedText("Please check `url` against the docs.")).toBe("url");
	expect(propertyRequestedText("Not explain `name`; find namespace.")).not.toBe("name");
});

test("arrow paths preserve literal ordered schema scope", () => {
	expect(propertyExplicitSchemaPaths("at items → object → spec → cpu, what does cores accept?")).toEqual([
		"items.object.spec.cpu",
	]);
	expect(propertyExplicitSchemaPaths("not at items → object → spec → cpu, find name")).toEqual([]);
	expect(propertyExplicitSchemaPaths("under first → child or second → child")).toEqual([]);
});
test("quoted contract verbs identify field rather than prose", () => {
	expect(propertyRequestedText("What does `cores` accept?")).toBe("cores");
	expect(propertyRequestedText("Which Terraform reference explains `store_provider` for xcsh_fixture?")).toBe(
		"store_provider",
	);
	expect(propertyRequestedText("Find the field rules for `status`.")).toBe("status");
	expect(propertyRequestedText("Verify `addr` against its reference.")).toBe("addr");
});

test("literal ordered breadcrumb is scope without a leading location verb", () => {
	expect(propertyExplicitSchemaPaths("verify `addr` ingress_egress_gw → routes → ipv4 against its reference")).toEqual(
		["ingress_egress_gw.routes.ipv4"],
	);
	expect(propertyExplicitSchemaPaths("not first → child; find name")).toEqual([]);
	expect(propertyExplicitSchemaPaths("compare first → child and second → child")).toEqual([]);
	expect(propertyExplicitSchemaPaths("at first → child")).toEqual(["first.child"]);
});

test("dual-family prose uses documented dual-stack vocabulary", () => {
	expect(propertyQueryTerms("dual-family next hop")).toContain("dual");
	expect(propertyQueryTerms("both address families")).toContain("stack");
	expect(propertyQueryTerms("`dual-family` literal")).not.toContain("stack");
});
