// Exposed development helper only; never certifies installed or held-out UAT.
export interface DevelopmentCandidate {
 uri: string;
 schema_path: string;
 description: string;
 parent_uri: string | null;
}
export interface DevelopmentCase {
 id: string;
 prompt: string;
 candidates: DevelopmentCandidate[];
}
const reserve = 1024;
const provenance = { development_only: true, qualification_passed: false, scope_supplied: false } as const;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify({ aggregated_output: JSON.stringify(value) }));
export function candidatePage(item: DevelopmentCase, offset: number) {
 if (!Number.isSafeInteger(offset) || offset < 0 || offset > item.candidates.length)
  throw new Error("Invalid candidate continuation offset");
 const result = {
  ...provenance,
  status: "complete" as "complete" | "oversized",
  id: item.id,
  prompt: item.prompt,
  candidates: [] as DevelopmentCandidate[],
  next_offset: null as number | null,
  oversized_uri: null as string | null,
 };
 if (bytes(result) > 4096 - reserve) throw new Error("Prompt exceeds discovery envelope budget");
 for (let index = offset; index < item.candidates.length; index++) {
  const candidate = item.candidates[index]!;
  const next = index + 1 < item.candidates.length ? index + 1 : null;
  const proposal = { ...result, candidates: [...result.candidates, candidate], next_offset: next };
  if (bytes(proposal) > 4096 - reserve) {
   if (result.candidates.length) { result.next_offset = index; break; }
   result.status = "oversized";
   result.oversized_uri = candidate.uri;
   result.next_offset = next;
   break;
  }
  Object.assign(result, proposal);
 }
 if (bytes(result) > 4096 - reserve) throw new Error("Discovery notice exceeds envelope budget");
 return result;
}
export function encodeDevelopmentResponse(content: string, budget: number, uri: string) {
 const full = new URL(uri);
 full.search = "?view=full";
 const result = {
  ...provenance,
  status: "complete" as "complete" | "oversized",
  content,
  uri,
  full_uri: full.toString(),
 };
 const consumerOversized = /^Oversized section:/m.test(content);
 if (consumerOversized) result.status = "oversized";
 if (bytes(result) <= budget - reserve) return result;
 const notice = { ...result, status: "oversized" as const, content: "Indivisible response exceeds the development envelope budget; read the full destination separately." };
 if (bytes(notice) > budget - reserve) throw new Error("Oversized notice exceeds envelope budget");
 return notice;
}

export function encodeDiscoveryResponse(content: string, uri: string) {
 const result = { ...provenance, status: "complete" as "complete" | "oversized", content, uri, continuation_uri: uri };
 if (bytes(result) <= 4096 - reserve) return result;
 const notice = { ...result, status: "oversized" as const, content: `Discovery envelope exceeds budget. Continue with discover ${uri}` };
 if (bytes(notice) > 4096 - reserve) throw new Error("Discovery continuation exceeds budget");
 return notice;
}

export async function resolveDiscoveryResponse(url: URL, resolve: (url: URL) => Promise<string>) {
 const attempt = new URL(url);
 for (;;) {
  const result = encodeDiscoveryResponse(await resolve(attempt), attempt.toString());
  if(result.status === "complete") return result;
  const limit = Number(attempt.searchParams.get("limit") ?? "5");
  if(!Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid discovery limit");
  if(limit === 1) return { ...result, continuation_uri: null, content: "Indivisible discovery response exceeds envelope budget. Reformulate the query or read an exact destination." };
  attempt.searchParams.set("limit", String(Math.max(1, Math.floor(limit / 2))));
 }
}
