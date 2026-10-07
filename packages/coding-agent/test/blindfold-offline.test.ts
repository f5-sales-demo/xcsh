import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlindfoldService } from "../src/services/blindfold";

const dir = mkdtempSync(join(tmpdir(), "blindfold-offline-"));
const pub = {
	data: { tenant: "example-tenant", key_version: 1, modulus_base64: "AQ==", public_exponent_base64: "AQAB" },
};
const policy = { data: { tenant: "example-tenant", policy_id: "101" } };
const publicKey = join(dir, "pub.json"),
	policyDocument = join(dir, "policy.yaml");
writeFileSync(publicKey, JSON.stringify(pub));
writeFileSync(policyDocument, 'data:\n  tenant: example-tenant\n  policy_id: "101"\n');
const args = { operation: "encrypt" as const, input: "secret", publicKey, policyDocument };
let io = 0;
const service = () =>
	new BlindfoldService({
		env: {},
		fetch: async () => {
			io++;
			throw new Error("network forbidden");
		},
		prepare: input => {
			expect(JSON.parse(input.publicKeyJson)).toEqual(pub);
			expect(JSON.parse(input.policyJson)).toEqual(policy);
			return { location: "string:///synthetic-ciphertext", tenant: "example-tenant" };
		},
	});
describe("Blindfold supplied material", () => {
	test("JSON/YAML encryption needs no credentials or network and contains no payload in report", async () => {
		const report = await service().run(args);
		expect(io).toBe(0);
		expect(report.materialSource).toBe("supplied");
		expect(report.target.apiUrl).toBeUndefined();
		expect(report.target.tenant).toBe("example-tenant");
		expect(JSON.stringify(report)).not.toContain("synthetic-ciphertext");
	});
	test("rejects ambiguous, malformed and mismatched material", async () => {
		for (const doc of [
			'data:\n tenant: other\n policy_id: "101"\n',
			'data:\n tenant: example-tenant\n tenant: other\n policy_id: "101"\n',
			"data: {}\n---\ndata: {}\n",
			"data:\n tenant: example-tenant\n policy_id: 101\n",
		]) {
			const f = join(dir, "bad.yaml");
			writeFileSync(f, doc);
			await expect(service().run({ ...args, policyDocument: f })).rejects.toThrow();
		}
	});
	test("partial files, format conflicts, policy conflicts and Plan Mode fail before network", async () => {
		for (const request of [
			{ ...args, policyDocument: undefined },
			{ ...args, output: "yaml" as const },
			{ operation: "policy" as const, policy: "shared/x", namespace: "shared" },
		])
			await expect(service().run(request)).rejects.toThrow();
		await expect(service().run({ ...args, outputFile: join(dir, "out") }, { planMode: true })).rejects.toThrow(
			"Plan mode",
		);
		expect(io).toBe(0);
	});
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
