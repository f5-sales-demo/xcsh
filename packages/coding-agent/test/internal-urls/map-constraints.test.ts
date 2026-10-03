import { describe, expect, it } from "bun:test";
import { formatMapConstraints, validateMapConstraints } from "../../src/internal-urls/map-constraints";

const rules = {
	constraintType: "map",
	keys: {
		type: "uint32-string",
		ranges: [
			[3, 3],
			[4, 4],
			[5, 5],
			[300, 599],
		],
	},
	values: { type: "string", maxLength: 65536, format: "uri-reference" },
	cardinality: { maxProperties: 16 },
};

describe("structured map constraints", () => {
	it("renders each scope", () => {
		const text = formatMapConstraints(rules);
		expect(text).toContain("values.maxLength: 65536");
		expect(text).toContain("cardinality.maxProperties: 16");
		expect(text).toContain("keys.ranges");
	});
	it("validates exact HTTP LB ranges and Base64 boundary", () => {
		expect(validateMapConstraints({ "300": `string:///${Buffer.alloc(49143).toString("base64")}` }, rules)).toEqual(
			[],
		);
		expect(
			validateMapConstraints({ "300": `string:///${Buffer.alloc(49144).toString("base64")}` }, rules),
		).not.toEqual([]);
		expect(validateMapConstraints({ "299": "string:///ok" }, rules)).not.toEqual([]);
		expect(validateMapConstraints({ "600": "string:///ok" }, rules)).not.toEqual([]);
		expect(validateMapConstraints({ "3": "/relative/path" }, rules)).toEqual([]);
	});
});
