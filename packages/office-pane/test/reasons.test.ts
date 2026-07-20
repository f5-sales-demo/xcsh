/**
 * Parity test: CHAT_ERROR_REASONS and INTERACTION_MODES must equal the values
 * expressed in xcsh's NATIVE chat-conformance.json (the source of truth, imported
 * directly from the coding-agent package — no vendored copy to drift).
 *
 * The contract represents discriminated string values via `anyOf[].const`, NOT
 * the JSON Schema `enum` keyword. We extract the const values for the parity
 * assertion.
 */
import { describe, expect, it } from "bun:test";
import conformance from "../../coding-agent/src/browser/chat-conformance.json";
import { CHAT_ERROR_REASONS, INTERACTION_MODES } from "../src/core/protocol/reasons";

type AnyOfEntry = { const?: string };
type SchemaWithAnyOf = { anyOf?: AnyOfEntry[] };
type SchemaWithProps = { properties?: Record<string, SchemaWithAnyOf> };

const schemas = conformance.schemas as unknown as Record<string, SchemaWithProps>;

function extractConsts(schema: SchemaWithAnyOf | undefined): string[] {
	return (schema?.anyOf ?? []).flatMap(e => (e.const !== undefined ? [e.const] : []));
}

describe("CHAT_ERROR_REASONS parity with native contract", () => {
	it("matches reason anyOf consts in chat_error schema", () => {
		const schemaReasons = extractConsts(schemas.chat_error?.properties?.reason);
		expect(schemaReasons.length).toBeGreaterThan(0);
		const reasons: string[] = [...CHAT_ERROR_REASONS];
		expect(reasons.sort()).toEqual(schemaReasons.sort());
	});
});

describe("INTERACTION_MODES parity with native contract", () => {
	it("matches mode anyOf consts in chat_request schema", () => {
		const schemaModes = extractConsts(schemas.chat_request?.properties?.mode);
		expect(schemaModes.length).toBeGreaterThan(0);
		const modes: string[] = [...INTERACTION_MODES];
		expect(modes.sort()).toEqual(schemaModes.sort());
	});
});
