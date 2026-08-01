import { describe, expect, it } from "bun:test";
import { loadArtifactText, parseArtifact } from "../scripts/generate-defaults";

const RELEASE_TAG = "v2.1.208";
const VERSION = "2.1.208";
const EXACT_ARTIFACT_URL =
	"https://github.com/f5-sales-demo/api-specs-enriched/releases/download/v2.1.208/minimal-export-defaults.json";

describe("generate-defaults exact release delivery", () => {
	it("downloads only the artifact attached to the dispatched release", async () => {
		const requestedUrls: string[] = [];
		const artifact = JSON.stringify({ resources: {}, version: VERSION });
		const artifactSha256 = new Bun.CryptoHasher("sha256").update(artifact).digest("hex");
		const fetcher = async (input: string | URL | Request): Promise<Response> => {
			requestedUrls.push(String(input));
			return new Response(artifact);
		};

		const loaded = await loadArtifactText(
			{
				API_SPECS_DEFAULTS_FILE: "/a/local/override/must/not/win.json",
				API_SPECS_DEFAULTS_SHA256: artifactSha256,
				API_SPECS_TAG: RELEASE_TAG,
				API_SPECS_VERSION: VERSION,
			},
			fetcher,
		);

		expect(requestedUrls).toEqual([EXACT_ARTIFACT_URL]);
		expect(loaded).toEqual({ source: EXACT_ARTIFACT_URL, text: artifact });
	});

	it("fails when the dispatched release has no defaults artifact", async () => {
		const fetcher = async (): Promise<Response> => new Response("not found", { status: 404 });

		await expect(
			loadArtifactText(
				{ API_SPECS_DEFAULTS_SHA256: "0".repeat(64), API_SPECS_TAG: RELEASE_TAG, API_SPECS_VERSION: VERSION },
				fetcher,
			),
		).rejects.toThrow(`minimal-export-defaults.json is absent from dispatched release ${RELEASE_TAG} (404)`);
	});

	it("rejects downloaded defaults whose bytes differ from the publication receipt", async () => {
		const fetcher = async (): Promise<Response> => Response.json({ resources: {}, version: VERSION });
		await expect(
			loadArtifactText(
				{ API_SPECS_DEFAULTS_SHA256: "0".repeat(64), API_SPECS_TAG: RELEASE_TAG, API_SPECS_VERSION: VERSION },
				fetcher,
			),
		).rejects.toThrow("differs from its immutable publication receipt");
	});

	it("rejects an artifact whose version differs from the dispatched version", () => {
		expect(() =>
			parseArtifact(
				{
					source: EXACT_ARTIFACT_URL,
					text: JSON.stringify({ resources: {}, version: "2.1.207" }),
				},
				{ releaseTag: RELEASE_TAG, version: VERSION },
			),
		).toThrow("minimal-export-defaults.json version 2.1.207 does not match dispatched version 2.1.208");
	});

	it("requires a version field that exactly matches the dispatched version", () => {
		expect(() =>
			parseArtifact(
				{ source: EXACT_ARTIFACT_URL, text: JSON.stringify({ resources: {} }) },
				{ releaseTag: RELEASE_TAG, version: VERSION },
			),
		).toThrow("minimal-export-defaults.json version undefined does not match dispatched version 2.1.208");
	});
});
