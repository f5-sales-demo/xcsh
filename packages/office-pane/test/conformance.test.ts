/**
 * Golden conformance: validate xcsh's NATIVE chat-conformance.json examples
 * against its own schemas, imported directly from the coding-agent package.
 * This asserts office-pane is built against a coherent, current contract.
 */
import { describe, expect, it } from "bun:test";
import Ajv from "ajv";
import capabilities from "../../coding-agent/src/browser/capabilities.json";
import conformance from "../../coding-agent/src/browser/chat-conformance.json";

const ajv = new Ajv({ strict: false });
const schemas = conformance.schemas as Record<string, object>;
const validExamples = conformance.examples.valid as Record<string, unknown>;
const invalidExamples = conformance.examples.invalid as Array<{
	schema: string;
	why: string;
	value: unknown;
}>;

// (a) Every golden valid example validates against its schema
describe("chat-conformance: valid examples validate against schemas", () => {
	for (const [name, example] of Object.entries(validExamples)) {
		const schemaKey = name.replace(/_no_\w+$|_\d+$/g, "");
		const schema = schemas[schemaKey];
		if (!schema) continue;
		it(`${name} validates against ${schemaKey} schema`, () => {
			const validate = ajv.compile(schema);
			expect(validate(example)).toBe(true);
		});
	}
});

// (b) Every golden invalid example is rejected
describe("chat-conformance: invalid examples are rejected", () => {
	for (const { schema: schemaKey, why, value } of invalidExamples) {
		const schema = schemas[schemaKey];
		if (!schema) continue;
		it(`${schemaKey}: ${why}`, () => {
			expect(ajv.compile(schema)(value)).toBe(false);
		});
	}
});

// (c) Drift check: contractVersion matches capabilities
describe("chat-conformance: drift guard", () => {
	it("contractVersion matches capabilities.json", () => {
		expect(conformance.contractVersion).toBe(capabilities.contractVersion);
	});
});
