import { expect, test } from "bun:test";
import {
	measureDocumentationRequests,
	validateDocumentationMeasurementRequests,
} from "../src/documentation-measurement";

test("general measurement permits only bounded current documentation requests", () => {
	expect(() => validateDocumentationMeasurementRequests([])).toThrow();
	expect(() => validateDocumentationMeasurementRequests(["https://example.com/"])).toThrow();
	expect(() => validateDocumentationMeasurementRequests(["xcsh://terraform-documentation/"])).toThrow();
	expect(validateDocumentationMeasurementRequests(["xcsh://documentation/?search=DNS"])).toHaveLength(1);
});
test("general measurement checks five identical full responses and anchored follow-up reads", async () => {
	const calls: string[] = [];
	const result = await measureDocumentationRequests(["xcsh://documentation/?search=DNS"], async uri => {
		calls.push(uri);
		return {
			content: uri.includes("search=")
				? "Read: xcsh://documentation/docs-cloud-f5-com/dns/index.md#setup\nCite: https://docs.cloud.f5.com/docs-v2/dns"
				: "# Setup\n\n```sh\ndig example.com\n```",
		};
	});
	expect(calls).toHaveLength(10);
	expect(result[0]!.times_ms).toHaveLength(5);
	expect(result[0]!.context).toContain("dig example.com");
	await expect(
		measureDocumentationRequests(["xcsh://documentation/"], async () => ({ content: String(Math.random()) })),
	).rejects.toThrow("Non-deterministic");
});
