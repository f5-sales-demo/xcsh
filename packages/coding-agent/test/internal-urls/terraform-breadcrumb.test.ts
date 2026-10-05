import { expect, test } from "bun:test";
import {
	propertyBreadcrumbText,
	propertyExplicitSchemaPaths,
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
