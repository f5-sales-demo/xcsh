import { expect, test } from "bun:test";
import { measureTerraformRequests, validateTerraformMeasurementRequests } from "../src/terraform-measurement";

const search = "xcsh://terraform-documentation/?search=fixture";
const target = "xcsh://terraform-documentation/documentation/resources/fixture/properties/index.md#schema-port";
test("installed measurement captures complete deterministic responses and five route timings", async () => {
	const reads: string[] = [];
	const rows = await measureTerraformRequests([search], async uri => {
		reads.push(uri);
		return { content: uri === search ? `Selected leaf;\nRead: ${target}\n` : "### port\n```hcl\nport = 443\n```" };
	});
	expect(reads).toHaveLength(10);
	expect(rows[0]?.route_times_ms).toHaveLength(5);
	expect(rows[0]?.context).toContain("```hcl");
	expect(rows[0]?.response_sha256).toHaveLength(64);
	expect(rows[0]?.tool_calls).toBe(10);
});
test("measurement rejects non-Terraform requests and malformed input before reading", async () => {
	let calls = 0;
	const read = async () => {
		calls++;
		return { content: "" };
	};
	for (const value of [[], ["https://example.invalid"], ["xcsh://terraform-documentation/?search=one", null]])
		await expect(measureTerraformRequests(value, read)).rejects.toThrow();
	expect(calls).toBe(0);
});
test("measurement never accepts oversized or non-deterministic complete responses", async () => {
	await expect(measureTerraformRequests([search], async () => ({ content: "x".repeat(4097) }))).rejects.toThrow(
		"budget",
	);
	let n = 0;
	await expect(measureTerraformRequests([search], async () => ({ content: String(n++) }))).rejects.toThrow(
		"Non-deterministic",
	);
	await expect(
		measureTerraformRequests([search], async uri => ({
			content: uri === search ? `Selected leaf;\nRead: ${target}` : "x".repeat(16385),
		})),
	).rejects.toThrow("budget");
});

test("request preflight rejects malformed input before index materialization", () => {
	expect(() => validateTerraformMeasurementRequests(["file:///tmp/fixture"])).toThrow("Terraform documentation");
	expect(() => validateTerraformMeasurementRequests([search, "https://example.invalid"])).toThrow();
	expect(validateTerraformMeasurementRequests([search])).toEqual([search]);
});
