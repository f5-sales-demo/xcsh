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
