import { describe, expect, it } from "bun:test";
import { parseWorkflowRef } from "@f5-sales-demo/xcsh/tools/catalog-workflow-runner";

describe("parseWorkflowRef", () => {
	// -------------------------------------------------------------------------
	// Valid cases
	// -------------------------------------------------------------------------

	it("parses a valid resource/operation ref", () => {
		expect(parseWorkflowRef("origin-pool/create")).toEqual({
			resource: "origin-pool",
			operation: "create",
		});
	});

	it("parses a simple single-segment resource and operation", () => {
		expect(parseWorkflowRef("http-load-balancer/delete")).toEqual({
			resource: "http-load-balancer",
			operation: "delete",
		});
	});

	it("parses refs where both segments are single lowercase words", () => {
		expect(parseWorkflowRef("site/view")).toEqual({ resource: "site", operation: "view" });
	});

	it("parses refs with numbers in segments", () => {
		expect(parseWorkflowRef("site2/create2")).toEqual({ resource: "site2", operation: "create2" });
	});

	// -------------------------------------------------------------------------
	// Invalid: empty / missing slash
	// -------------------------------------------------------------------------

	it("throws for an empty string", () => {
		expect(() => parseWorkflowRef("")).toThrow(/invalid workflow ref/i);
	});

	it("throws when there is no slash (bare operation)", () => {
		expect(() => parseWorkflowRef("create")).toThrow(/invalid workflow ref/i);
	});

	// -------------------------------------------------------------------------
	// Invalid: too many slashes
	// -------------------------------------------------------------------------

	it("throws when there are two slashes (a/b/c)", () => {
		expect(() => parseWorkflowRef("a/b/c")).toThrow(/invalid workflow ref/i);
	});

	it("throws for a deep path with traversal characters", () => {
		expect(() => parseWorkflowRef("../x/y")).toThrow(/invalid workflow ref/i);
	});

	// -------------------------------------------------------------------------
	// Invalid: empty segment
	// -------------------------------------------------------------------------

	it("throws when resource is empty (/create)", () => {
		expect(() => parseWorkflowRef("/create")).toThrow(/invalid workflow ref/i);
	});

	it("throws when operation is empty (create/)", () => {
		expect(() => parseWorkflowRef("create/")).toThrow(/invalid workflow ref/i);
	});

	// -------------------------------------------------------------------------
	// Invalid: bad characters (uppercase, underscore, traversal)
	// -------------------------------------------------------------------------

	it("throws for uppercase letters in resource (Origin_Pool/create)", () => {
		expect(() => parseWorkflowRef("Origin_Pool/create")).toThrow(/invalid workflow ref/i);
	});

	it("throws for underscores in resource", () => {
		expect(() => parseWorkflowRef("origin_pool/create")).toThrow(/invalid workflow ref/i);
	});

	it("throws for traversal path in resource (../x segment)", () => {
		// "../x" contains dots; the regex requires start with [a-z0-9]
		expect(() => parseWorkflowRef("../x")).toThrow(/invalid workflow ref/i);
	});
});
