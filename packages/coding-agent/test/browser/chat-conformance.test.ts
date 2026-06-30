/**
 * Conformance tests: validate xcsh's chat protocol types and serializers
 * against the extension's published chat-conformance.json artifact.
 */

import { describe, expect, it } from "bun:test";
import { isChatRequest, isChatStop } from "@f5-sales-demo/xcsh/browser/chat-protocol";
import Ajv from "ajv";
import conformance from "../../src/browser/chat-conformance.json";

const ajv = new Ajv({ strict: false });

const schemas = conformance.schemas as Record<string, object>;
const validExamples = conformance.examples.valid as Record<string, unknown>;
const invalidExamples = conformance.examples.invalid as Array<{
	schema: string;
	why: string;
	value: unknown;
}>;

describe("chat-conformance: valid examples validate against schemas", () => {
	for (const [name, example] of Object.entries(validExamples)) {
		const schemaKey = name.replace(/_no_\w+$|_\d+$/g, "");
		const schema = schemas[schemaKey];
		if (!schema) continue;

		it(`${name} validates against ${schemaKey} schema`, () => {
			const validate = ajv.compile(schema);
			const valid = validate(example);
			if (!valid) {
				throw new Error(`Validation failed: ${JSON.stringify(validate.errors)}`);
			}
			expect(valid).toBe(true);
		});
	}
});

describe("chat-conformance: invalid examples are rejected by schemas", () => {
	for (const { schema: schemaKey, why, value } of invalidExamples) {
		const schema = schemas[schemaKey];
		if (!schema) continue;

		it(`${schemaKey}: ${why}`, () => {
			const validate = ajv.compile(schema);
			expect(validate(value)).toBe(false);
		});
	}
});

describe("chat-conformance: xcsh parsers accept valid examples", () => {
	it("isChatRequest accepts valid chat_request example", () => {
		expect(isChatRequest(validExamples.chat_request as Record<string, unknown>)).toBe(true);
	});

	it("isChatRequest accepts valid chat_request_no_context example", () => {
		expect(isChatRequest(validExamples.chat_request_no_context as Record<string, unknown>)).toBe(true);
	});

	it("isChatStop accepts valid chat_stop example", () => {
		expect(isChatStop(validExamples.chat_stop as Record<string, unknown>)).toBe(true);
	});
});

describe("chat-conformance: xcsh parsers reject invalid examples", () => {
	for (const { schema: schemaKey, why, value } of invalidExamples) {
		if (schemaKey === "chat_request") {
			it(`isChatRequest rejects: ${why}`, () => {
				expect(isChatRequest(value as Record<string, unknown>)).toBe(false);
			});
		}
		if (schemaKey === "chat_stop") {
			it(`isChatStop rejects: ${why}`, () => {
				expect(isChatStop(value as Record<string, unknown>)).toBe(false);
			});
		}
	}
});

describe("chat-conformance: xcsh outbound frames validate against schemas", () => {
	it("chat_delta frame validates", () => {
		const frame = { type: "chat_delta", id: "c-test", seq: 0, delta: "hello" };
		const validate = ajv.compile(schemas.chat_delta);
		expect(validate(frame)).toBe(true);
	});

	it("chat_done frame validates", () => {
		const frame = {
			type: "chat_done",
			id: "c-test",
			references: [{ kind: "doc", title: "Test", url: "https://docs.cloud.f5.com/test" }],
		};
		const validate = ajv.compile(schemas.chat_done);
		expect(validate(frame)).toBe(true);
	});

	it("chat_done frame without references validates", () => {
		const frame = { type: "chat_done", id: "c-test" };
		const validate = ajv.compile(schemas.chat_done);
		expect(validate(frame)).toBe(true);
	});

	it("chat_error frame validates", () => {
		const frame = { type: "chat_error", id: "c-test", error: "something broke" };
		const validate = ajv.compile(schemas.chat_error);
		expect(validate(frame)).toBe(true);
	});
});

describe("chat-conformance: contract version matches", () => {
	it("conformance artifact version matches capabilities contract version", () => {
		const capabilities = require("../../src/browser/capabilities.json");
		expect(conformance.contractVersion).toBe(capabilities.contractVersion);
	});
});
