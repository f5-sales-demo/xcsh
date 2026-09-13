import { expect, test } from "bun:test";
import {
	createSalesforceRelationshipCollector,
	rankTerritoryCandidates,
} from "../src/person-profile/salesforce-discovery";

test("Salesforce territory candidates use actual queryable metadata", () => {
	expect(
		rankTerritoryCandidates([
			{ name: "Territory__c", label: "Territory", type: "string", groupable: true, filterable: true },
			{ name: "Territory_Notes__c", type: "textarea", groupable: false, filterable: true },
			{ name: "Unsafe'Field", label: "Territory", type: "string", groupable: true, filterable: true },
		]),
	).toEqual(["Territory__c"]);
});

test("Salesforce relationship discovery retains inferred partner and role evidence separately", async () => {
	const collector = createSalesforceRelationshipCollector(
		async () => ({ identifiers: { salesforceId: "005000000000001" } }),
		async argv => {
			const query = argv[argv.indexOf("--query") + 1] ?? "";
			let result: unknown = {};
			if (argv.includes("display")) result = { username: "synthetic@example.com" };
			else if (query.includes("Username ="))
				result = { records: [{ Id: "005000000000001", UserRole: { Name: "Synthetic role" } }] };
			else if (query.includes("ORDER BY COUNT"))
				result = {
					records: [{ UserId: "005000000000002", User: { Name: "Synthetic Partner", Title: "Engineer" } }],
				};
			else if (argv.includes("describe")) result = { fields: [] };
			else result = { records: [] };
			return { exitCode: 0, stdout: JSON.stringify({ result }) };
		},
		() => true,
	);
	const result = await collector.collect();
	expect(result).toHaveProperty("facts", {});
	expect(JSON.stringify(result)).toContain('"field":"partner"');
	expect(JSON.stringify(result)).toContain('"kind":"inferred"');
	expect(JSON.stringify(result)).toContain("Synthetic role");
});
