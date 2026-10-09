import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBlindfoldCli } from "../src/commands/blindfold-args";
import { BlindfoldService } from "../src/services/blindfold";
import { normalizeBlindfoldDocument, readBlindfoldDocument } from "../src/services/blindfold-documents";

const dir = mkdtempSync(join(tmpdir(), "blindfold-interchange-"));
const pub = {
	data: { tenant: "example-tenant", key_version: 7, modulus_base64: "AQ==", public_exponent_base64: "AQAB" },
};
const camel = {
	data: { tenant: "example-tenant", keyVersion: 7, modulusBase64: "AQ==", publicExponentBase64: "AQAB" },
};
const policy = { data: { tenant: "example-tenant", policy_id: "101" } };
const env = { XCSH_API_URL: "https://example-tenant.console.ves.volterra.io", XCSH_API_TOKEN: "synthetic-token" };
const keyFile = join(dir, "public"),
	policyFile = join(dir, "policy");
writeFileSync(keyFile, JSON.stringify(camel));
writeFileSync(policyFile, 'data:\n tenant: example-tenant\n policyId: "101"\n');
const offline = { operation: "encrypt" as const, publicKey: keyFile, policyDocument: policyFile, input: "secret" };

describe("Blindfold interchangeability adapters", () => {
	test("canonical and compatibility defaults and explicit selections", () => {
		expect(parseBlindfoldCli(["secrets", "get-public-key"], true, false)).toMatchObject({ compatibility: true });
		expect(parseBlindfoldCli(["secrets", "get-policy-document", "--name", "custom"], true, false)).toMatchObject({
			namespace: "default",
			name: "custom",
		});
		expect(() => parseBlindfoldCli(["secrets", "get-policy-document"], true, false)).toThrow("name");
		for (const compat of [true, false]) {
			const head = compat ? ["secrets", "get-public-key"] : ["public-key"];
			for (const value of ["0", "7", "4294967295"])
				expect(parseBlindfoldCli([...head, "--key-version", value], compat, false).keyVersion).toBe(Number(value));
			for (const value of ["-1", "4294967296", "1.2", "1e2", "", "NaN"])
				expect(() => parseBlindfoldCli([...head, "--key-version", value], compat, false)).toThrow();
			const enc = compat ? ["secrets", "encrypt"] : ["encrypt"];
			expect(parseBlindfoldCli([...enc, "secret", "--encoding", "base64"], compat, false).encoding).toBe("base64");
		}
		expect(
			parseBlindfoldCli(["secrets", "encrypt", "secret", "--outfmt", "yaml"], true, false).output,
		).toBeUndefined();
		for (const flags of [
			["--outfile", "out", "--output-file", "text"],
			["--outfile", "out", "--json"],
			["--outfile", "out", "--encoding", "base64"],
			["--outfile", "out", "--result-file", "out"],
		])
			expect(() => parseBlindfoldCli(["secrets", "encrypt", "secret", ...flags], true, false)).toThrow();
		expect(() =>
			parseBlindfoldCli(["secrets", "get-public-key", "--output", "yaml", "--outfmt", "json"], true, false),
		).toThrow();
		expect(() => parseBlindfoldCli(["encrypt", "secret", "--outfile", "out"], false, false)).toThrow();
	});
	test("only known aliases normalize, duplicate aliases and malformed fields fail", async () => {
		expect(normalizeBlindfoldDocument(camel, "public-key")).toEqual(pub);
		expect(() => normalizeBlindfoldDocument({ data: { ...pub.data, ...camel.data } }, "public-key")).toThrow();
		for (const data of [
			{ ...camel.data, key_version: 8 },
			{ ...camel.data, keyVersion: "7" },
			{ ...camel.data, modulusBase64: "bad!" },
			{ ...camel.data, tenant: [camel.data.tenant] },
			{ tenant: "example-tenant", KEY_VERSION: 7 },
		])
			expect(() => normalizeBlindfoldDocument({ data }, "public-key")).toThrow();
		for (const text of [
			'{"data":{"tenant":"example-tenant","policyId":"101","policyId":"101"}}',
			'data:\n tenant: example-tenant\n policyId: "101"\n---\ndata: {}',
			'data:\n tenant: example-tenant\n policyId: "101"\n policy_id: "102"',
		]) {
			const f = join(dir, "invalid");
			writeFileSync(f, text);
			await expect(readBlindfoldDocument(f, "policy")).rejects.toThrow();
		}
	});
	test("retrieval formats retain public policy information and exact version requests fail closed", async () => {
		let emitted = "";
		const urls: string[] = [];
		const fullPolicy = {
			data: {
				...policy.data,
				policy_info: { rules: [{ name: "public-rule", custom_field: "retained" }] },
				description: "public",
			},
		};
		const service = new BlindfoldService({
			env,
			emit: text => {
				emitted = text;
			},
			fetch: async url => {
				urls.push(url);
				return Response.json(url.includes("get_public_key") ? camel : fullPolicy);
			},
		});
		await service.run({ operation: "public-key", compatibility: true, keyVersion: 7 });
		expect(urls.at(-1)).toContain("?key_version=7");
		expect(emitted).toContain("keyVersion: 7");
		await service.run({ operation: "public-key", keyVersion: 0 });
		expect(urls.at(-1)).not.toContain("key_version=0");
		expect(JSON.parse(emitted)).toEqual(pub);
		await expect(service.run({ operation: "public-key", keyVersion: 8 })).rejects.toThrow("version");
		await service.run({ operation: "policy", compatibility: true, name: "custom" });
		expect(urls.at(-1)).toContain("namespaces/default/");
		expect(emitted).toContain("policyInfo:");
		expect(emitted).toContain("custom_field: retained");
		await service.run({ operation: "policy", output: "json" });
		expect(JSON.parse(emitted)).toEqual(fullPolicy);
	});
	test("rejects oversized public documents and duplicate API JSON keys", async () => {
		const file = join(dir, "oversized-public");
		writeFileSync(file, Buffer.alloc(2 * 1024 * 1024 + 1));
		await expect(readBlindfoldDocument(file, "public-key")).rejects.toThrow("2 MiB");
		for (const text of [
			'{"data":{"tenant":"example-tenant","key_version":7,"key_version":7}}',
			"data: {}\n---\ndata: {}",
			"x".repeat(2 * 1024 * 1024 + 1),
		]) {
			const service = new BlindfoldService({ env, fetch: async () => new Response(text) });
			await expect(service.run({ operation: "public-key" })).rejects.toThrow();
		}
	});
	test("encoding and raw artifacts share decoded bytes and public reports never contain ciphertext", async () => {
		let emitted = "";
		const service = new BlindfoldService({
			env: {},
			cwd: dir,
			emit: text => {
				emitted = text;
			},
			prepare: input => {
				expect(JSON.parse(input.publicKeyJson)).toEqual(pub);
				expect(JSON.parse(input.policyJson)).toEqual(policy);
				return { location: "string:///AAECA/8=", tenant: "example-tenant" };
			},
		});
		await service.run(offline);
		expect(emitted).toBe("string:///AAECA/8=\n");
		const report = await service.run({ ...offline, compatibility: true });
		expect(emitted).toBe("AAECA/8=\n");
		expect(JSON.stringify(report)).not.toContain("AAECA");
		await service.run({ ...offline, encoding: "base64", outputFile: "text" });
		expect(readFileSync(join(dir, "text"), "utf8")).toBe("AAECA/8=\n");
		emitted = "";
		await service.run({ ...offline, compatibility: true, outfile: "raw", resultFile: "report" });
		expect(emitted).toBe("");
		expect(readFileSync(join(dir, "raw"))).toEqual(Buffer.from([0, 1, 2, 3, 255]));
		expect(statSync(join(dir, "raw")).mode & 0o777).toBe(0o600);
		expect(readFileSync(join(dir, "report"), "utf8")).not.toContain("AAECA");
		await expect(service.run({ ...offline, compatibility: true, outfile: "raw" })).rejects.toThrow("new");
		symlinkSync(join(dir, "text"), join(dir, "link"));
		await expect(service.run({ ...offline, compatibility: true, outfile: "link" })).rejects.toThrow("new");
		await expect(
			service.run({ ...offline, compatibility: true, outfile: "blocked" }, { planMode: true }),
		).rejects.toThrow("Plan mode");
	});
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
