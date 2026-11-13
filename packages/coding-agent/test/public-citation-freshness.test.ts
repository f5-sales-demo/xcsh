import { describe, expect, test } from "bun:test";
import type { CorpusSource, CorpusSources } from "../scripts/corpus-sources";
import * as corpus from "../scripts/corpus-sources";

const source = (tag: string, archive: string): CorpusSource => ({
	repository: "example/source",
	tag,
	commit: "c".repeat(40),
	acceptance: "immutable",
	assets: { [archive]: { sha256: "a".repeat(64), size_bytes: 42 } },
});
const sources: CorpusSources = {
	general: source("content-20260101T000000Z", "html-to-markdown-content.tar.gz"),
	terraform: source("documentation-v1.2.3", "canonical-documentation.tar.gz"),
	provider: source("v1.2.3", "terraform-provider.zip"),
	api: source("v1.0.0", "f5xc-api-specs-v1.0.0.zip"),
};
const mapping = {
	general: { version: sources.general.tag, digest: "a".repeat(64) },
	terraform: { version: sources.terraform.tag, digest: "a".repeat(64) },
	api: { version: sources.api.tag, digest: "a".repeat(64) },
};

describe("build-time public citation freshness", () => {
	test("accepts matching independently selected source versions and archive digests", () => {
		expect(() => corpus.assertFreshPublicCitationSources(sources, mapping)).not.toThrow();
	});

	for (const family of ["general", "terraform", "api"] as const) {
		test(`rejects a stale ${family} citation version even when the archive digest matches`, () => {
			const stale = { ...mapping, [family]: { ...mapping[family], version: "earlier-source" } };
			expect(() => corpus.assertFreshPublicCitationSources(sources, stale)).toThrow(
				`stale ${family} public citation`,
			);
		});

		test(`rejects a stale ${family} citation digest even when the source version matches`, () => {
			const stale = { ...mapping, [family]: { ...mapping[family], digest: "b".repeat(64) } };
			expect(() => corpus.assertFreshPublicCitationSources(sources, stale)).toThrow(
				`stale ${family} public citation`,
			);
		});

		test(`rejects missing ${family} publication evidence`, () => {
			const incomplete: Partial<typeof mapping> = { ...mapping };
			delete incomplete[family];
			expect(() => corpus.assertFreshPublicCitationSources(sources, incomplete)).toThrow(
				`stale ${family} public citation`,
			);
		});
	}
});
