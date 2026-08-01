import { describe, expect, it } from "bun:test";
import { exactProviderIndexUrl, loadTerraformIndex } from "../../scripts/generate-terraform-index";

const PROVIDER_TAG = "v3.73.0";
const PROVIDER_COMMIT = "a".repeat(40);
const EXACT_URL = `https://raw.githubusercontent.com/f5-sales-demo/terraform-provider-xcsh/${PROVIDER_COMMIT}/docs/terraform-llms-index.json`;

describe("Terraform index exact provider delivery", () => {
	it("bypasses mutable local/main sources for the immutable provider tag", async () => {
		const requested: string[] = [];
		const document = { provider: { source: "f5-sales-demo/xcsh" }, version: "0.1.0" };
		const fetcher = async (input: string | URL | Request): Promise<Response> => {
			requested.push(String(input));
			return Response.json(document);
		};

		const loaded = await loadTerraformIndex(
			{ TERRAFORM_PROVIDER_COMMIT: PROVIDER_COMMIT, TERRAFORM_PROVIDER_TAG: PROVIDER_TAG },
			fetcher,
		);

		expect(requested).toEqual([EXACT_URL]);
		expect(loaded).toEqual({ data: document, providerCommit: PROVIDER_COMMIT, providerTag: PROVIDER_TAG });
	});

	it("fails when the exact provider release has no Terraform index", async () => {
		const fetcher = async (): Promise<Response> => new Response("not found", { status: 404 });

		await expect(
			loadTerraformIndex(
				{ TERRAFORM_PROVIDER_COMMIT: PROVIDER_COMMIT, TERRAFORM_PROVIDER_TAG: PROVIDER_TAG },
				fetcher,
			),
		).rejects.toThrow(
			`Failed to fetch terraform-llms-index.json from provider release v3.73.0 at ${PROVIDER_COMMIT}: 404`,
		);
	});

	it("rejects a mutable or malformed provider ref", async () => {
		expect(() => exactProviderIndexUrl("main")).toThrow("full lowercase Git SHA");
		expect(exactProviderIndexUrl(PROVIDER_COMMIT)).toBe(EXACT_URL);
		await expect(loadTerraformIndex({ TERRAFORM_PROVIDER_TAG: PROVIDER_TAG })).rejects.toThrow(
			"TERRAFORM_PROVIDER_TAG and TERRAFORM_PROVIDER_COMMIT must be provided together",
		);
	});
});
