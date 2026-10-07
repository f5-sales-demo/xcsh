import { describe, expect, test } from "bun:test";
import { createDecipheriv, generateKeyPairSync } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { blindfoldPrepare } from "@f5-sales-demo/pi-natives";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blindfold-test-"));
const pair = generateKeyPairSync("rsa", { modulusLength: 2048, publicExponent: 65537 });
const jwk = pair.privateKey.export({ format: "jwk" });
const b64 = (v: string) => Buffer.from(v, "base64url").toString("base64");
const pub = JSON.stringify({
	data: { tenant: "example-tenant", key_version: 1, modulus_base64: b64(jwk.n!), public_exponent_base64: b64(jwk.e!) },
});
const policy = JSON.stringify({
	data: { tenant: "example-tenant", namespace: "shared", name: "example-policy", policy_id: "101" },
});
const file = path.join(dir, "secret");
fs.writeFileSync(file, Buffer.alloc(2048, 120));
const prepare = () => blindfoldPrepare({ publicKeyJson: pub, policyJson: policy, input: file });
const integer = (b: Buffer) => BigInt(`0x${b.toString("hex") || "0"}`);
function modpow(b: bigint, e: bigint, m: bigint): bigint {
	let r = 1n;
	for (; e > 0n; e >>= 1n, b = (b * b) % m) if (e & 1n) r = (r * b) % m;
	return r;
}
function inverse(a: bigint, m: bigint): bigint {
	const orig = m;
	let x = 1n,
		y = 0n;
	while (m) {
		const q = a / m;
		[a, m] = [m, a % m];
		[x, y] = [y, x - q * y];
	}
	if (a !== 1n) throw new Error("not invertible");
	return ((x % orig) + orig) % orig;
}
function recover(location: string, pid = 101n, tamper = false): Buffer {
	const raw = Buffer.from(location.slice(10), "base64");
	let at = 0;
	const take = (n: number) => {
		const out = raw.subarray(at, at + n);
		at += n;
		return out;
	};
	const lp = () => take(take(4).readUInt32BE());
	expect(lp().toString()).toBe("example-tenant");
	expect(take(4).readUInt32BE()).toBe(1);
	expect(take(8).readBigUInt64BE()).toBe(101n);
	expect(take(1)[0]).toBe(2);
	const e = integer(lp()),
		n = integer(lp());
	expect(e).toBe(65537n);
	const wrapped = lp();
	const ciphertext = Buffer.from(raw.subarray(at));
	const p = integer(Buffer.from(jwk.p!, "base64url")),
		q = integer(Buffer.from(jwk.q!, "base64url"));
	const d = inverse(e * (2n * pid + (1n << 31n) + 1n), (p - 1n) * (q - 1n));
	const block = Buffer.from(modpow(integer(wrapped), d, n).toString(16).padStart(508, "0"), "hex");
	if (block.subarray(0, 4).toString("hex") !== "deadbeef") throw new Error("wrong policy");
	if (tamper) ciphertext[0] ^= 1;
	const aes = createDecipheriv("aes-256-gcm", block.subarray(16, 48), block.subarray(4, 16));
	aes.setAuthTag(ciphertext.subarray(-16));
	return Buffer.concat([aes.update(ciphertext.subarray(0, -16)), aes.final()]);
}
describe("native Blindfold protocol", () => {
	test("independently recovers a 2 KB secret and validates binary fields", () =>
		expect(recover(prepare().location)).toEqual(Buffer.alloc(2048, 120)));
	test("randomizes envelopes", () => expect(prepare().location).not.toBe(prepare().location));
	test("fails wrong-policy recovery and tampering", () => {
		const v = prepare();
		expect(() => recover(v.location, 102n)).toThrow();
		expect(() => recover(v.location, 101n, true)).toThrow();
	});
	test("rejects tenant mismatch and malformed public material", () => {
		expect(() =>
			blindfoldPrepare({
				publicKeyJson: pub,
				policyJson: policy.replace("example-tenant", "other-tenant"),
				input: file,
			}),
		).toThrow();
		expect(() => blindfoldPrepare({ publicKeyJson: "{}", policyJson: policy, input: file })).toThrow();
	});
	test("checks final encoded-size boundary", () => {
		expect(() =>
			blindfoldPrepare({ publicKeyJson: pub, policyJson: policy, input: file, maxEncodedSize: 100 }),
		).toThrow();
		const size = prepare().location.length;
		expect(
			blindfoldPrepare({ publicKeyJson: pub, policyJson: policy, input: file, maxEncodedSize: size }).location
				.length,
		).toBe(size);
	});
	test("sanitizes file errors", () => {
		expect(() =>
			blindfoldPrepare({ publicKeyJson: pub, policyJson: policy, input: path.join(dir, "missing") }),
		).toThrow("Cannot read Blindfold input");
	});
});
const fixture = (name: string) => path.join(import.meta.dir, "fixtures/blindfold", name);
describe("native certificate inputs", () => {
	for (const algorithm of ["rsa", "ec"]) {
		test(`${algorithm} parses PEM and protected PEM without an external executable`, () => {
			const oldPath = process.env.PATH;
			process.env.PATH = "";
			process.env.BLINDFOLD_TEST_PASS = "synthetic-test-passphrase";
			try {
				for (const key of [`${algorithm}-key.pem`, `${algorithm}-protected.pem`]) {
					const v = blindfoldPrepare({
						publicKeyJson: pub,
						policyJson: policy,
						cert: fixture(`${algorithm}.pem`),
						key: fixture(key),
						passphraseEnv: key.includes("protected") ? "BLINDFOLD_TEST_PASS" : undefined,
					});
					expect(v.algorithm).toBe(algorithm.toUpperCase());
					expect(v.fingerprint).toMatch(/^[a-f0-9]{64}$/);
					expect(recover(v.location).toString()).toContain("BEGIN PRIVATE KEY");
					expect(Buffer.from(v.certificateUrl!.slice(10), "base64").toString()).toContain("BEGIN CERTIFICATE");
				}
			} finally {
				process.env.PATH = oldPath;
				delete process.env.BLINDFOLD_TEST_PASS;
			}
		});
		test(`${algorithm} parses protected PKCS#12 natively`, () => {
			process.env.BLINDFOLD_TEST_PASS = "synthetic-test-passphrase";
			try {
				expect(
					blindfoldPrepare({
						publicKeyJson: pub,
						policyJson: policy,
						bundle: fixture(`${algorithm}.p12`),
						passphraseEnv: "BLINDFOLD_TEST_PASS",
					}).algorithm,
				).toBe(algorithm.toUpperCase());
			} finally {
				delete process.env.BLINDFOLD_TEST_PASS;
			}
		});
	}
	test("rejects wrong passwords, missing passwords, malformed files, mixed inputs and mismatched keys", () => {
		process.env.BLINDFOLD_TEST_PASS = "wrong-synthetic-passphrase";
		try {
			expect(() =>
				blindfoldPrepare({
					publicKeyJson: pub,
					policyJson: policy,
					cert: fixture("rsa.pem"),
					key: fixture("rsa-protected.pem"),
					passphraseEnv: "BLINDFOLD_TEST_PASS",
				}),
			).toThrow();
			expect(() =>
				blindfoldPrepare({
					publicKeyJson: pub,
					policyJson: policy,
					cert: fixture("rsa.pem"),
					key: fixture("rsa-protected.pem"),
				}),
			).toThrow();
			expect(() =>
				blindfoldPrepare({
					publicKeyJson: pub,
					policyJson: policy,
					bundle: fixture("rsa.p12"),
					passphraseEnv: "BLINDFOLD_TEST_PASS",
				}),
			).toThrow();
			expect(() =>
				blindfoldPrepare({
					publicKeyJson: pub,
					policyJson: policy,
					bundle: fixture("rsa.p12"),
					cert: fixture("rsa.pem"),
				}),
			).toThrow();
			expect(() =>
				blindfoldPrepare({
					publicKeyJson: pub,
					policyJson: policy,
					cert: fixture("rsa.pem"),
					key: fixture("ec-key.pem"),
				}),
			).toThrow("does not match");
			expect(() =>
				blindfoldPrepare({ publicKeyJson: pub, policyJson: policy, cert: file, key: fixture("ec-key.pem") }),
			).toThrow();
		} finally {
			delete process.env.BLINDFOLD_TEST_PASS;
		}
	});
});

describe("Blindfold certificate failure boundaries", () => {
	test("rejects ambiguous PKCS#12 even with identical aliases", () => {
		process.env.BLINDFOLD_TEST_PASS = "synthetic-test-passphrase";
		try {
			expect(() =>
				blindfoldPrepare({
					publicKeyJson: pub,
					policyJson: policy,
					bundle: fixture("ambiguous.p12"),
					passphraseEnv: "BLINDFOLD_TEST_PASS",
				}),
			).toThrow("exactly one private key");
		} finally {
			delete process.env.BLINDFOLD_TEST_PASS;
		}
	});
	test("rejects expired and incorrectly linked chains", () => {
		for (const cert of ["expired.pem", "wrong-chain.pem"]) {
			expect(() =>
				blindfoldPrepare({
					publicKeyJson: pub,
					policyJson: policy,
					cert: fixture(cert),
					key: fixture("rsa-key.pem"),
				}),
			).toThrow();
		}
	});
});
