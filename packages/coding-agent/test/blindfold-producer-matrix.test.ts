import { afterAll, expect, test } from "bun:test";
import { createDecipheriv, createPrivateKey } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { BlindfoldService } from "../src/services/blindfold";
import {
	normalizeBlindfoldDocument,
	parseBlindfoldDocument,
	serializeBlindfoldDocument,
} from "../src/services/blindfold-documents";

const directory = mkdtempSync(join(tmpdir(), "blindfold-matrix-"));
const fixtures = await Bun.file(join(import.meta.dir, "../../natives/test/fixtures/blindfold-synthetic.json")).json();
const key = createPrivateKey(Buffer.from(fixtures["rsa-key.pem"], "base64")).export({ format: "jwk" });
const integer = (bytes: Buffer) => BigInt(`0x${bytes.toString("hex") || "0"}`);
const power = (base: bigint, exponent: bigint, modulus: bigint) => {
	let result = 1n;
	for (; exponent > 0n; exponent >>= 1n, base = (base * base) % modulus)
		if (exponent & 1n) result = (result * base) % modulus;
	return result;
};
function inverse(value: bigint, modulus: bigint): bigint {
	const original = modulus;
	let x = 1n,
		y = 0n;
	while (modulus) {
		const quotient = value / modulus;
		[value, modulus] = [modulus, value % modulus];
		[x, y] = [y, x - quotient * y];
	}
	if (value !== 1n) throw new Error("No inverse");
	return ((x % original) + original) % original;
}
function decrypt(raw: Buffer): Buffer {
	let cursor = 0;
	const take = (size: number) => {
		if (size < 0 || cursor + size > raw.length) throw new Error("Truncated envelope");
		const value = raw.subarray(cursor, cursor + size);
		cursor += size;
		return value;
	};
	const lp = () => take(take(4).readUInt32BE());
	expect(lp().toString()).toBe("example-tenant");
	expect(take(4).readUInt32BE()).toBe(1);
	expect(take(8).readBigUInt64BE()).toBe(101n);
	expect(take(1)[0]).toBe(2);
	const exponent = integer(lp()),
		modulus = integer(lp());
	expect(exponent).toBe(65537n);
	expect(modulus).toBe(integer(Buffer.from(key.n!, "base64url")));
	const wrapped = integer(lp());
	const p = integer(Buffer.from(key.p!, "base64url")),
		q = integer(Buffer.from(key.q!, "base64url"));
	const block = Buffer.from(
		power(wrapped, inverse(exponent * (203n + (1n << 31n)), (p - 1n) * (q - 1n)), modulus)
			.toString(16)
			.padStart(508, "0"),
		"hex",
	);
	expect(block.subarray(0, 4).toString("hex")).toBe("deadbeef");
	const aes = createDecipheriv("aes-256-gcm", block.subarray(16, 48), block.subarray(4, 16));
	aes.setAuthTag(raw.subarray(-16));
	return Buffer.concat([aes.update(raw.subarray(cursor, -16)), aes.final()]);
}
const secret = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256));
writeFileSync(join(directory, "secret"), secret);
test("every producer, spelling and format recovers independently through native encryption", async () => {
	for (const version of ["historical", "0.2.47"]) {
		const pub = parseBlindfoldDocument(
			readFileSync(join(import.meta.dir, "fixtures/blindfold", `${version}-pub.yaml`), "utf8"),
		);
		const policy = parseBlindfoldDocument(
			readFileSync(join(import.meta.dir, "fixtures/blindfold", `${version}-policy.yaml`), "utf8"),
		);
		const producers = (material: unknown, kind: "public-key" | "policy") => {
			const snake = normalizeBlindfoldDocument(material, kind);
			const camel = parseBlindfoldDocument(serializeBlindfoldDocument(snake, "json", true)) as {
				data: Record<string, unknown>;
			};
			expect(() => normalizeBlindfoldDocument({ data: { ...snake.data, ...camel.data } }, kind)).toThrow();
			return [material, snake, camel];
		};
		for (const publicMaterial of producers(pub, "public-key"))
			for (const policyMaterial of producers(policy, "policy"))
				for (const format of ["json", "yaml"] as const) {
					writeFileSync(
						join(directory, "pub"),
						format === "json" ? JSON.stringify(publicMaterial) : stringify(publicMaterial),
					);
					writeFileSync(
						join(directory, "policy"),
						format === "json" ? JSON.stringify(policyMaterial) : stringify(policyMaterial),
					);
					let text = "";
					const service = new BlindfoldService({
						env: {},
						cwd: directory,
						emit: value => {
							text = value;
						},
					});
					const request = {
						operation: "encrypt" as const,
						input: "secret",
						publicKey: "pub",
						policyDocument: "policy",
						compatibility: true,
					};
					const report = await service.run(request);
					expect(text).toMatch(/^[A-Za-z0-9+/]+=*\n$/);
					expect(decrypt(Buffer.from(text.trim(), "base64"))).toEqual(secret);
					expect(JSON.stringify(report)).not.toContain(text.trim());
				}
	}
	const service = new BlindfoldService({ env: {}, cwd: directory });
	await service.run({
		operation: "encrypt",
		input: "secret",
		publicKey: "pub",
		policyDocument: "policy",
		compatibility: true,
		outfile: "envelope",
	});
	const raw = readFileSync(join(directory, "envelope"));
	expect(decrypt(raw)).toEqual(secret);
	raw[raw.length - 1] ^= 1;
	expect(() => decrypt(raw)).toThrow();
}, 60000);
afterAll(() => rmSync(directory, { recursive: true, force: true }));
