import { expect, test } from "bun:test";
import { createHash, X509Certificate } from "node:crypto";
import { parseBlindfoldCli } from "../src/commands/blindfold-args";
import { BlindfoldService } from "../src/services/blindfold";

const synthetic = await Bun.file(
	new URL("../../natives/test/fixtures/blindfold-synthetic.json", import.meta.url),
).json();
const certificateUrl = `string:///${synthetic["rsa.pem"]}`;
const cert = new X509Certificate(Buffer.from(synthetic["rsa.pem"], "base64"));
const digest = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const pub = {
	data: { tenant: "example-tenant", key_version: 1, modulus_base64: "AQ==", public_exponent_base64: "AQAB" },
};
const policy = { data: { tenant: "example-tenant", policy_id: "101" } };
const env = {
	XCSH_API_URL: "https://example.console.ves.volterra.io",
	XCSH_API_TOKEN: "private-marker",
	XCSH_NAMESPACE: "example",
};
const args = { operation: "ensure" as const, name: "example-cert", cert: "cert.pem", key: "key.pem" };
test("ensure parses named and manifest forms", () => {
	expect(
		parseBlindfoldCli(["ensure", "--name", "example-cert", "--cert", "cert.pem", "--key", "key.pem"], false, true)
			.operation,
	).toBe("ensure");
	expect(parseBlindfoldCli(["ensure", "-f", "resource.yaml"], false, true).file).toBe("resource.yaml");
});
test("ensure reuses remote ciphertext after restart without encrypting or writing", async () => {
	let saved: Record<string, unknown> | undefined;
	const writes: string[] = [];
	let encryption = 0;
	const options = {
		env,
		prepare: (input: { inspectOnly?: boolean }) => {
			if (!input.inspectOnly) encryption++;
			return {
				location: input.inspectOnly ? "" : "string:///ciphertext",
				certificateUrl,
				fingerprint: digest(cert.raw),
				expiresAt: "future",
				algorithm: "RSA",
				tenant: "example-tenant",
			};
		},
		fetch: async (url: string, init?: RequestInit) => {
			if (url.includes("get_public_key")) return Response.json(pub);
			if (url.includes("get_policy_document")) return Response.json(policy);
			if (init?.method === "GET") return saved ? Response.json(saved) : Response.json({}, { status: 404 });
			writes.push(init!.method!);
			saved = JSON.parse(String(init!.body));
			return Response.json({});
		},
	};
	expect((await new BlindfoldService(options).run(args)).status).toBe("accepted");
	expect((await new BlindfoldService(options).run(args)).status).toBe("unchanged");
	expect(encryption).toBe(1);
	expect(writes).toEqual(["POST"]);
	expect(JSON.stringify(await new BlindfoldService(options).run(args))).not.toContain("ciphertext");
});
