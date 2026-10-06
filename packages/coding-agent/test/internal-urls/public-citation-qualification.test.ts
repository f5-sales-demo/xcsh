import { expect, test } from "bun:test";
import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import { auditPublicCitations } from "../../bench/terraform-retrieval/public-citation-audit";

const read =
	"xcsh://terraform-documentation/documentation/resources/address_allocator/properties/address_allocation_scheme/index.md#schema-address_allocation_scheme--allocation_unit";
const publicUrl =
	"https://f5-sales-demo.github.io/terraform-provider-xcsh/resources/address_allocator/properties/address_allocation_scheme/";
const answer = (text: string): AgentMessage =>
	({ role: "assistant", content: [{ type: "text", text }] }) as AgentMessage;

test("qualification compares public citations through the verified source mapping", () => {
	expect(
		auditPublicCitations([answer(`See [source](${publicUrl}).`)], [read]).required_public_citations_verified,
	).toBe(true);
	expect(auditPublicCitations([answer(`See ${read}.`)], [read]).required_public_citations_verified).toBe(false);
	expect(auditPublicCitations([answer("No source citation.")], [read]).required_public_citations_verified).toBe(false);
	expect(
		auditPublicCitations([answer(`See ${publicUrl}`)], [read.replace("address_allocator", "retired")])
			.required_public_citations_verified,
	).toBe(false);
	expect(
		auditPublicCitations([answer(`See ${publicUrl}. Code: \`${read}\``)], [read]).internal_documentation_citations,
	).toBe(false);
});

test("URLs in code cannot satisfy a required public citation", () => {
	expect(auditPublicCitations([answer(`Example: \`${publicUrl}\``)], [read]).required_public_citations_verified).toBe(
		false,
	);
	expect(
		auditPublicCitations([answer(`\`\`\`text\n${publicUrl}\n\`\`\``)], [read]).required_public_citations_verified,
	).toBe(false);
});
