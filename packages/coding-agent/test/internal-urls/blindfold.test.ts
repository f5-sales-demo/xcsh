import { describe, expect, it } from "bun:test";
import { InternalDocsProtocolHandler, InternalUrlRouter } from "../../src/internal-urls";
import { EMBEDDED_DOCS } from "../../src/internal-urls/docs-index.generated";

const router = new InternalUrlRouter();
router.register(new InternalDocsProtocolHandler());
describe("native Blindfold task routes", () => {
	it("serves a bounded index with task destinations", async () => {
		const index = await router.resolve("xcsh://blindfold/");
		expect(index.size).toBeLessThanOrEqual(2048);
		for (const route of ["encrypt", "certificate", "verify"])
			expect(index.content).toContain(`xcsh://blindfold/${route}`);
	});
	it("serves complete relevant native guide sections and source identity", async () => {
		const sections = {
			encrypt: [
				"Retrieve public encryption material",
				"Encrypt a secret or prepare a certificate manifest",
				"Offline encryption",
			],
			certificate: [
				"Encrypt a secret or prepare a certificate manifest",
				"Use protected PEM and PKCS#12 inputs",
				"Create and rotate a certificate",
			],
			verify: ["Verify HTTPS after API acceptance", "Resolve failures and uncertain writes"],
		};
		const guide = EMBEDDED_DOCS["en/f5-distributed-cloud/blindfold-certificates.mdx"];
		for (const [route, headings] of Object.entries(sections)) {
			const resource = await router.resolve(`xcsh://blindfold/${route}`);
			expect(resource.contentType).toBe("text/markdown");
			expect(resource.content).toContain("Source:");
			expect(resource.content).toContain("Version:");
			expect(resource.content).toContain("https://github.com/f5-sales-demo/xcsh/");
			for (const heading of headings) {
				const section = guide.split(`## ${heading}\n`)[1]?.split("\n## ")[0];
				expect(section).toBeDefined();
				expect(resource.content).toContain(section!.trim());
			}
			expect(resource.content).not.toContain("## Replace the vesctl secrets procedure");
		}
	});
	it("rejects unknown destinations with valid routes", async () => {
		for (const url of [
			"xcsh://blindfold/delete",
			"xcsh://blindfold/encrypt?execute=1",
			"xcsh://blindfold/%2e%2e/encrypt",
		])
			await expect(router.resolve(url)).rejects.toThrow("xcsh://blindfold/");
	});
});
