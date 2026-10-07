import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlindfoldService } from "../src/services/blindfold";
import { readBlindfoldDocument } from "../src/services/blindfold-documents";

const dir = mkdtempSync(join(tmpdir(), "blindfold-retrieval-"));
const env = {
	XCSH_API_URL: "https://example-tenant.console.ves.volterra.io",
	XCSH_API_TOKEN: "synthetic-token",
	XCSH_CONTEXT_NAME: "selected",
	XCSH_NAMESPACE: "unrelated",
};
const documents = {
	"public-key": {
		data: { tenant: "example-tenant", key_version: 1, modulus_base64: "AQ==", public_exponent_base64: "AQAB" },
	},
	policy: { data: { tenant: "example-tenant", policy_id: "101" } },
};
describe("Blindfold retrieval contracts", () => {
	test("JSON and YAML round trip and policy selectors never choose context", async () => {
		for (const operation of ["public-key", "policy"] as const)
			for (const output of ["json", "yaml"] as const) {
				let artifact = "";
				const calls: string[] = [];
				const service = new BlindfoldService({
					env,
					emit: text => {
						artifact = text;
					},
					fetch: async url => {
						calls.push(url);
						return Response.json(documents[operation]);
					},
				});
				const report = await service.run({
					operation,
					output,
					...(operation === "policy" ? { namespace: "shared", name: "custom" } : {}),
				});
				const file = join(dir, operation + output);
				writeFileSync(file, artifact);
				expect(await readBlindfoldDocument(file, operation)).toEqual(documents[operation]);
				expect(report.materialSource).toBe("retrieved");
				expect(report.target.contextName).toBe("selected");
				if (operation === "policy") expect(calls[0]).toContain("namespaces/shared/secret_policys/custom/");
			}
	});
	test("context mismatch fails before fetch", async () => {
		let calls = 0;
		const service = new BlindfoldService({
			env,
			fetch: async () => {
				calls++;
				throw new Error();
			},
		});
		await expect(service.run({ operation: "public-key", contextName: "other" })).rejects.toThrow("context mismatch");
		expect(calls).toBe(0);
	});
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
