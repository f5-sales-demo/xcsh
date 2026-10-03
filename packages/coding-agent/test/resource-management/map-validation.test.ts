import { expect, test } from "bun:test";
import { validateManifest } from "@f5-sales-demo/pi-resource-management";
import { kindResolver } from "../../src/resource-management";

for (const [name, values, valid] of [
	["valid", { "404": "/error.html" }, true],
	["key", { "200": "/error.html" }, false],
	["pairs", Object.fromEntries(Array.from({ length: 17 }, (_, i) => [String(300 + i), "/error.html"])), false],
	["uri", { "404": "space here" }, false],
	["base64-49143", { "404": `string:///${Buffer.alloc(49143).toString("base64")}` }, true],
	["base64-49144", { "404": `string:///${Buffer.alloc(49144).toString("base64")}` }, false],
] as const) {
	test(`manifest map contract ${name}`, () => {
		const rawObject = {
			kind: "http_loadbalancer",
			metadata: { name: "acceptance", namespace: "default" },
			spec: { domains: ["example.invalid"], routes: [], origin_pools: [], more_option: { custom_errors: values } },
		};
		const { result } = validateManifest({ ...rawObject, rawObject }, kindResolver);
		expect(result.valid).toBe(valid);
		if (!valid) expect(result.errors.some(e => e.path === "spec.more_option.custom_errors")).toBe(true);
	});
}

test("identity operations do not validate supplied map fields", () => {
	const rawObject = {
		kind: "http_loadbalancer",
		metadata: { name: "acceptance", namespace: "default" },
		spec: { more_option: { custom_errors: { "200": "space here" } } },
	};
	expect(
		validateManifest({ ...rawObject, rawObject }, kindResolver, undefined, { operation: "identity" }).result.valid,
	).toBe(true);
});

test("update applies canonical PUT map metadata", () => {
	const rawObject = {
		kind: "http_loadbalancer",
		metadata: { name: "acceptance", namespace: "default" },
		spec: { more_option: { custom_errors: { "200": "/error.html" } } },
	};
	expect(
		validateManifest({ ...rawObject, rawObject }, kindResolver, undefined, { operation: "update" }).result.errors,
	).toContainEqual({ path: "spec.more_option.custom_errors", message: "key 200 outside ranges", code: "INVALID_MAP" });
});
