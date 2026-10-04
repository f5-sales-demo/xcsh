import { expect, test } from "bun:test";
import {
	propertyBreadcrumbText,
	propertyExplicitSchemaPaths,
} from "../../src/internal-urls/terraform-property-ranking";

test("explicit schema breadcrumbs retain adjacency and negation", () => {
	expect(propertyExplicitSchemaPaths("under service > advertise_options > https > certificates, find name")).toEqual([
		"service.advertise_options.https.certificates",
	]);
	expect(propertyExplicitSchemaPaths("not under service > https > certificates, find name")).toEqual([]);
	expect(propertyBreadcrumbText("under tls > custom_security")).toBe("under tls.custom_security");
});
