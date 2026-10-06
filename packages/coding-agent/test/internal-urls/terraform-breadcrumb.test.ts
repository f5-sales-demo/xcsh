import { expect, test } from "bun:test";
import {
	propertyBreadcrumbText,
	propertyCookieOperators,
	propertyExplicitSchemaPaths,
	propertyMatchesCookieOperators,
	propertyMatchesExplicitPaths,
	propertyOrderedNestingPath,
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

test("repeated within clauses preserve complete contiguous nesting order", () => {
	expect(
		propertyOrderedNestingPath(
			"endpoint policy content, within protected endpoints, within protected endpoints, within cookie or, within values against its reference",
		),
	).toBe("protected_endpoints.protected_endpoints.cookie_or.values");
	expect(propertyOrderedNestingPath("not endpoint policy content, within cookie or, within values")).toBeUndefined();
	expect(propertyOrderedNestingPath("inside a cookie, within values")).toBeUndefined();
	expect(propertyOrderedNestingPath("root, within cookie or or cookie and, within values")).toBeUndefined();
});

test("ordered nesting requires contiguous repeated segments", () => {
	const row = { schema_path: "root.protected_endpoints.protected_endpoints.cookie_or.values" } as Parameters<
		typeof propertyMatchesExplicitPaths
	>[1];
	const q = "root, within protected endpoints, within protected endpoints, within cookie or, within values";
	expect(propertyMatchesExplicitPaths(q, row)).toBe(true);
	expect(propertyMatchesExplicitPaths(q, { ...row, schema_path: "root.protected_endpoints.cookie_or.values" })).toBe(
		false,
	);
	expect(
		propertyMatchesExplicitPaths(q, {
			...row,
			schema_path: "root.protected_endpoints.protected_endpoints.cookie_and.values",
		}),
	).toBe(false);
});

test("quoted field nouns preserve direct field identity within prose", () => {
	expect(propertyRequestedText("Help with the HCL field `prefixes` on managed resource xcsh_fixture.")).toBe(
		"prefixes",
	);
	expect(propertyRequestedText("Find attribute `hostname` in the backend settings.")).toBe("hostname");
	expect(propertyRequestedText("Not field `name`; find namespace.")).not.toBe("name");
	expect(propertyRequestedText("Example field `name`; find namespace.")).not.toBe("name");
	expect(propertyRequestedText("Compare field `name` and attribute `namespace`.")).not.toBe("name");
});

test("outer and inner cookie operator assertions retain separate nesting", () => {
	const query = "the outer cookie group uses AND, and the inner cookie group also uses OR";
	expect(propertyCookieOperators(query)).toEqual(["and", "or"]);
	const row = { schema_path: "cookie_v2.cookies_and.cookie_operator.cookie.cookie_or.match.value" } as any;
	expect(propertyMatchesCookieOperators(query, row)).toBe(true);
	expect(
		propertyMatchesCookieOperators(query, {
			...row,
			schema_path: row.schema_path.replace("cookie_or", "cookie_and"),
		}),
	).toBe(false);
	for (const q of [
		"outer cookie group uses AND",
		"outer cookie group uses AND, inner cookie group uses AND, outer cookie group uses OR",
		"not outer cookie group uses AND, inner cookie group uses AND",
		"compare outer cookie group uses AND, inner cookie group uses OR",
	])
		expect(propertyCookieOperators(q)).toBeUndefined();
});

test("unquoted example abbreviation is not a schema path", () => {
	expect(propertyExplicitSchemaPaths("Find name; e.g. default flavor reference")).toEqual([]);
	expect(propertyExplicitSchemaPaths("Find name under tls.certificates; e.g. client settings")).toEqual([
		"tls.certificates",
	]);
	expect(propertyExplicitSchemaPaths("under `e.g` find value")).toEqual(["e.g"]);
});

test("exclusive IP-family prose distinguishes single-family from dual-stack", () => {
	expect(propertyQueryTerms("IPv4-only next-hop address")).toContain("single");
	expect(propertyQueryTerms("IPv6 only next-hop address")).toContain("single");
	expect(propertyQueryTerms("IPv4 next-hop address")).not.toContain("single");
	expect(propertyQueryTerms("not IPv4-only next-hop address")).not.toContain("single");
	expect(propertyQueryTerms("`IPv4-only` literal")).not.toContain("single");
});

test("individually quoted breadcrumb components preserve complete adjacency", () => {
	expect(propertyBreadcrumbText("selected `root` → `branch` → `field`.")).toBe("selected root.branch.field.");
	expect(propertyExplicitSchemaPaths("selected `root` → `branch` → `field`. Explain value.")).toEqual([
		"root.branch.field",
	]);
	expect(propertyExplicitSchemaPaths("not `root` → `branch` → `field`.")).toEqual([]);
	expect(propertyExplicitSchemaPaths("compare `root` → `first` and `root` → `second`.")).toEqual([]);
});
