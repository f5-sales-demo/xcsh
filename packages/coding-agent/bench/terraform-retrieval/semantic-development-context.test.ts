import { expect, test } from "bun:test";
import { candidatePage, encodeDevelopmentResponse, type DevelopmentCandidate } from "./semantic-development-context";

const rows: DevelopmentCandidate[] = Array.from({ length: 20 }, (_, i) => ({
 uri: `xcsh://terraform-documentation/documentation/resources/fixture/properties/index.md#schema-field_${i}`,
 schema_path: `field_${i}`,
 description: "Complete quoted description \" with UTF-8 🧪. ".repeat(12),
 parent_uri: null,
}));
test("candidate continuation preserves every complete record within serialized discovery budget", () => {
 let offset = 0;
 const found: typeof rows = [];
 do {
  const response = candidatePage({ id: "synthetic", prompt: "Terraform fixture", candidates: rows }, offset);
  expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThanOrEqual(4096 - 512);
  expect(response.status).toBe("complete");
  found.push(...response.candidates);
  if (response.next_offset === null) break;
  expect(response.next_offset).toBeGreaterThan(offset);
  offset = response.next_offset;
 } while (offset < rows.length);
 expect(found).toEqual(rows);
});
test("indivisible candidate returns exact read destination and advances without clipping", () => {
 const item = { ...rows[0]!, description: "🧪".repeat(5000) };
 const result = candidatePage({ id: "oversized", prompt: "Terraform", candidates: [item, rows[1]!] }, 0);
 expect(result.status).toBe("oversized");
 expect(result.oversized_uri).toBe(item.uri);
 expect(result.next_offset).toBe(1);
 expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(4096);
});
test("context uses serialized envelope bytes and retains complete fences", () => {
 const section = "```hcl\nvalue = \"🧪\"\n```\n";
 const result = encodeDevelopmentResponse(section, 16384, rows[0]!.uri);
 expect(result.status).toBe("complete");
 expect(result.content).toBe(section);
 expect(encodeDevelopmentResponse(section.repeat(1000), 16384, rows[0]!.uri).status).toBe("oversized");
});
test("invalid offsets are rejected and empty discovery is explicit", () => {
 const item = { id: "synthetic", prompt: "Terraform", candidates: rows };
 for (const offset of [-1, 0.5, NaN, 21]) expect(() => candidatePage(item, offset)).toThrow();
 const empty = candidatePage({ ...item, candidates: [] }, 0);
 expect(empty.candidates).toEqual([]);
 expect(empty.next_offset).toBeNull();
});

test("quote-heavy descriptions fit the outer serialized command response", () => {
 const quote = { ...rows[0]!, description: '\"'.repeat(1500) };
 const response = candidatePage({ id: "quotes", prompt: "Terraform", candidates: [quote] }, 0);
 const envelope = JSON.stringify({ aggregated_output: JSON.stringify(response) });
 expect(Buffer.byteLength(envelope)).toBeLessThanOrEqual(4096 - 512);
});
