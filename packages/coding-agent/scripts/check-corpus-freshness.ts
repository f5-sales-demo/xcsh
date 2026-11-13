import { requireFreshPublicCitationSources } from "./corpus-sources";

await requireFreshPublicCitationSources();
console.log("All corpus sources remain current at publication.");
