import { expect, test } from "bun:test";
import { terraformBranchChoices, terraformRoleChoices } from "../../src/internal-urls/terraform-branch-choices";

const rows = Array.from({ length: 9 }, (_, index) => ({
	provider_type: "resources",
	provider_name: "fixture",
	description: "Cookie case sensitivity.",
	schema_path: `login.cookies_${["and", "or", "none"][Math.floor(index / 3)]}.cookie_${["and", "or", "none"][index % 3]}.case_sensitive`,
	path: `documentation/resources/fixture/${index}/index.md`,
	anchor: "schema-case_sensitive",
}));
test("branch choices cover every equivalent leaf with a bounded first decision", () => {
	const choices = terraformBranchChoices(rows);
	expect(choices).toEqual(["login.cookies_and", "login.cookies_none", "login.cookies_or"]);
	expect(rows.every(row => choices.filter(prefix => row.schema_path.startsWith(`${prefix}.`)).length === 1)).toBe(
		true,
	);
	expect(terraformBranchChoices([...rows].reverse())).toEqual(choices);
});
test("role and semantic collisions cannot be grouped as one hierarchy", () => {
	expect(
		terraformBranchChoices(rows.map((row, index) => (index ? row : { ...row, provider_type: "data-sources" }))),
	).toEqual([]);
	expect(terraformBranchChoices(rows.slice(0, 3))).toEqual([]);
	expect(
		terraformBranchChoices(rows.map((row, index) => (index ? row : { ...row, description: "Different meaning." }))),
	).toEqual([]);
});

test("supplied endpoint and field qualifiers skip already decided hierarchy branches", () => {
	const expanded = [
		...rows.map(row => ({ ...row, schema_path: `mobile.success.cookies.${row.schema_path}` })),
		...rows.map(row => ({ ...row, schema_path: `web.success.body.${row.schema_path}` })),
	];
	expect(terraformBranchChoices(expanded, 5, "mobile success cookies case sensitivity")).toEqual([
		"mobile.success.cookies.login.cookies_and",
		"mobile.success.cookies.login.cookies_none",
		"mobile.success.cookies.login.cookies_or",
	]);
});

test("role choices precede branch choices when equivalent leaves exceed the response limit", () => {
	const all = [...rows.slice(0, 3), ...rows.slice(0, 3).map(row => ({ ...row, provider_type: "data-sources" }))];
	expect(terraformRoleChoices(all)).toEqual(["data-sources", "resources"]);
	expect(terraformRoleChoices(rows)).toEqual([]);
	expect(
		terraformRoleChoices(all.map((row, index) => (index ? row : { ...row, description: "Different meaning" }))),
	).toEqual([]);
});
