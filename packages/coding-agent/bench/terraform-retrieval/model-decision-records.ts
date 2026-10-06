interface DecisionRecord {
 id: string;
 preserve_filters: string;
 decision: { choices: Array<{ destination: string }> };
}
interface DecisionCase { id: string; kind: string; prompt: string; expected: string[] }

/** Validate source-reviewed model decisions without inventing retrieval requests. */
export function validateModelDecisionRecords(records: DecisionRecord[], cases: DecisionCase[]): string[] {
 const seen = new Set<string>();
 for (const record of records) {
  const item = cases.find(candidate => candidate.id === record.id && candidate.kind === "ambiguous");
  const destinations = record.decision?.choices?.map(choice => choice.destination);
  if (!item || seen.has(record.id) || !Array.isArray(destinations) ||
   destinations.length !== item.expected.length || new Set(destinations).size !== destinations.length ||
   destinations.some(destination => !item.expected.includes(destination)) || record.preserve_filters !== item.prompt)
   throw new Error("Frozen model clarification decision mismatch");
  seen.add(record.id);
 }
 return [...seen];
}
