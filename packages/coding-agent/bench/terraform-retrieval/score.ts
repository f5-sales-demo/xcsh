export function scoreDestinations(
 kind: "answerable" | "ambiguous" | "control",
 selected: boolean,
 destinations: string[],
 expected: string[],
 matchDocument = false,
) {
 const normalize = (uri: string) => { const url = new URL(uri); url.search = ""; return url.href; };
 const actual = destinations.map(normalize);
 const wanted = expected.map(normalize);
 const matches = (a: string, b: string) => matchDocument ? a.split("#")[0] === b.split("#")[0] : a === b;
 const rank = actual.findIndex(uri => wanted.some(want => matches(uri, want))) + 1;
 const matchedExpected = wanted.filter(want => actual.slice(0, 5).some(uri => matches(uri, want))).length;
 const selectionCorrect = kind === "answerable" ? selected && rank === 1 :
  kind === "ambiguous" ? !selected && wanted.length >= 2 && matchedExpected === wanted.length : null;
 return { rank: rank || null, top5: rank > 0 && rank <= 5, matchedExpected, selectionCorrect };
}

export function validateQualificationSource(
 freeze:{source_provider_version:string;source_commit?:string;receipt_sha256?:string;source_index_sha256?:string},
 pin:{provider_version:string;source_commit:string;receipt_sha256:string;index?:{sha256:string}},
 regression:boolean,
):void {
 if(freeze.source_provider_version!==pin.provider_version ||
  (freeze.source_commit && freeze.source_commit!==pin.source_commit) ||
  (freeze.receipt_sha256 && freeze.receipt_sha256!==pin.receipt_sha256))
  throw new Error("Frozen qualification provider source mismatch");
 if(!regression && freeze.source_index_sha256 && freeze.source_index_sha256!==pin.index?.sha256)
  throw new Error("Frozen qualification index mismatch; use --regression for post-analysis evidence");
}
