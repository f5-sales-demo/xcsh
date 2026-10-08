import { describe, expect, it } from "bun:test";
import { classifyBlindfoldIntent, renderBlindfoldHint } from "../src/internal-urls/blindfold-intent";

describe("Blindfold user task intent", () => {
	it("matches owned inputs and explicit native operations", () => {
		for (const text of [
			"Explain blindfold",
			"How does blindfolding work?",
			"Use xcsh_blindfold",
			"blindfold_secret_info location",
			"Upload a custom certificate",
			"Bring your own certificate",
			"BYOC",
			"Prepare a certificate/key pair",
			"Import protected PEM",
			"Prepare a PKCS#12 bundle",
			"Encrypt my private key",
			"Private-key encryption",
			"Rotate our certificate",
			"Import my secret",
			"Use automatic certificates and upload my custom certificate",
			"Use protected PEM",
			"Use PKCS#12",
			"Upload my custom certificate to F5 XC with an AWS origin",
			"Encrypt my TLS private key",
		]) {
			expect(classifyBlindfoldIntent(text, false)).toBe(true);
		}
	});
	it("excludes other platforms, managed certificates, inspection and unrelated encryption", () => {
		for (const text of [
			"Use AWS ACM to import my custom certificate",
			"Upload a custom certificate to Azure",
			"Use Kubernetes cert-manager",
			"Automatic certificate rotation",
			"Rotate a managed certificate",
			"Renew with ACME",
			"Inspect the public certificate",
			"TLS handshake error",
			"Encrypt a disk",
			"Explain AES encryption",
			"Inspect a public certificate and explain encryption",
			"Rotate my managed certificate",
			"Read the attached article",
			"New topic: write a poem",
			"Do not use blindfold",
		]) {
			expect(classifyBlindfoldIntent(text, true)).toBe(false);
		}
	});
	it("maintains only related follow-ups", () => {
		expect(classifyBlindfoldIntent("Now prepare it offline", true)).toBe(true);
		expect(classifyBlindfoldIntent("Use the same key pair", true)).toBe(true);
		expect(classifyBlindfoldIntent("Now verify it", false)).toBe(false);
		expect(classifyBlindfoldIntent("What is the weather?", true)).toBe(false);
	});
	it("renders bounded conditional discovery with no user content", () => {
		const dormant = renderBlindfoldHint(false);
		expect(Buffer.byteLength(dormant)).toBeLessThanOrEqual(1024);
		expect(dormant).toContain('query: "xcsh_blindfold"');
		expect(dormant).toContain("limit: 1");
		expect(dormant).toContain("xcsh://blindfold/");
		expect(renderBlindfoldHint(true)).not.toContain("search_tool_bm25");
	});
});
