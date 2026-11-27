import { afterAll, expect, test } from "bun:test";
import { createPrivateKey } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { recoverBlindfoldFixture } from "../scripts/blindfold-native-fixture";
import { BlindfoldService } from "../src/services/blindfold";
import {
	normalizeBlindfoldDocument,
	parseBlindfoldDocument,
	serializeBlindfoldDocument,
} from "../src/services/blindfold-documents";

const directory = mkdtempSync(join(tmpdir(), "blindfold-matrix-"));
const fixtures = await Bun.file(join(import.meta.dir, "../../natives/test/fixtures/blindfold-synthetic.json")).json();
const key = createPrivateKey(Buffer.from(fixtures["rsa-key.pem"], "base64")).export({ format: "jwk" });
const decrypt = (raw: Buffer) => recoverBlindfoldFixture(`string:///${raw.toString("base64")}`, key);
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
