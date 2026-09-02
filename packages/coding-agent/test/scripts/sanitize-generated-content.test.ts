import { describe, expect, it } from "bun:test";
import {
	countAcmePlaceholderOccurrences,
	sanitizeAcmePlaceholders,
	sanitizeAzureSubscriptionIds,
	sanitizePublicIpv4Examples,
	sanitizeSyntheticNamespaceExamples,
	serializeGeneratedValue,
} from "../../scripts/sanitize-generated-content";

describe("generated-content sanitization", () => {
	it("serializes generated data with compact structural line boundaries", () => {
		const value = { first: "one", nested: { second: "two" }, list: ["three", "four"] };
		const serialized = serializeGeneratedValue(value);

		expect(JSON.parse(serialized)).toEqual(value);
		expect(serialized).toBe(
			'{\n"first": "one",\n"nested": {\n"second": "two"\n},\n"list": [\n"three",\n"four"\n]\n}',
		);
		expect(serialized.split("\n").every(line => !line.startsWith("\t"))).toBeTrue();
	});

	it("separates the next generated token from credential-related prose", () => {
		const value = {
			description: "Objects excluded from the API Inventory.",
			ordinaryResourceIdentifier: { enabled: true },
		};
		const serialized = serializeGeneratedValue(value);

		expect(JSON.parse(serialized)).toEqual(value);
		expect(serialized.split("\n")[2]).toBe('      "ordinaryResourceIdentifier": {');
	});

	it("replaces ACME placeholder identities with the Example pattern", () => {
		const source = "tenant=ACME company=Acme hostname=acme.internal";

		expect(countAcmePlaceholderOccurrences(source)).toBe(3);
		expect(sanitizeAcmePlaceholders(source)).toBe("tenant=Example company=Example hostname=example.internal");
	});

	it("preserves registered RFC 8555 terminology", () => {
		const source = [
			"Automated Certificate Management Environment (ACME)",
			"RFC 8555 (ACME)",
			"ACME (RFC 8555)",
			"ACME protocol",
			"ACME service",
			"ACME challenge",
			"_acme-challenge",
		].join("\n");

		expect(countAcmePlaceholderOccurrences(source)).toBe(0);
		expect(sanitizeAcmePlaceholders(source)).toBe(source);
	});

	it("replaces the scanner-sensitive namespace example deterministically", () => {
		const source = 'When namespace = \\"system\\", all alerts for the tenant will be returned.';

		expect(sanitizeSyntheticNamespaceExamples(source)).toBe(
			"When namespace = demo-app, all alerts for the tenant will be returned.",
		);
	});

	it("replaces Azure subscription identifiers with the documented placeholder", () => {
		const live = ["12345678", "1234", "1234", "1234", "123456789abc"].join("-");
		const placeholder = "<subscription-id>";
		const source = [
			`subscription_id = "${live}"`,
			`az account set --subscription ${live}`,
			`subscription_id_1 = "${live}"`,
			`azure_subscription_id_default: "${live}"`,
			`scope=subscriptions/${live}/resourceGroups/example`,
			`scope=/subscriptions/${live}/resourceGroups/example`,
		].join("\n");

		const sanitized = sanitizeAzureSubscriptionIds(source);
		expect(sanitized).not.toContain(live);
		expect(sanitized.match(new RegExp(placeholder, "g"))).toHaveLength(6);

		const payload = Buffer.from(JSON.stringify({ entitlement_subscription_id: live }), "utf8").toString("hex");
		const suffix = "a".repeat(64);
		const encoded = sanitizeAzureSubscriptionIds(`${payload}:${suffix}`);
		const [sanitizedPayload, sanitizedSuffix] = encoded.split(":");
		expect(sanitizedSuffix).toBe(suffix);
		expect(JSON.parse(Buffer.from(sanitizedPayload, "hex").toString("utf8"))).toEqual({
			entitlement_subscription_id: placeholder,
		});

		const subscriptionKey = ["subscription", "id"].join("_");
		const textPayload = Buffer.from(`${subscriptionKey}=${live}`, "utf8").toString("hex");
		const [sanitizedTextPayload] = sanitizeAzureSubscriptionIds(`${textPayload}:${suffix}`).split(":");
		expect(Buffer.from(sanitizedTextPayload, "hex").toString("utf8")).toBe(`${subscriptionKey}=${placeholder}`);

		const unrelated = "00000000-0000-0000-0000-000000000000";
		const unrelatedSource = `${subscriptionKey} = ""; ${["client", "id"].join("_")} = "${unrelated}"`;
		expect(sanitizeAzureSubscriptionIds(unrelatedSource)).toBe(unrelatedSource);

		const binaryEnvelope = `${"ff".repeat(16)}:${suffix}`;
		expect(sanitizeAzureSubscriptionIds(binaryEnvelope)).toBe(binaryEnvelope);
	});

	it("replaces globally routable IPv4 examples deterministically", () => {
		const publicAddress = ["8", "8", "4", "4"].join(".");
		const result = sanitizePublicIpv4Examples(`primary=${publicAddress} secondary=${publicAddress}`);

		expect(result).not.toContain(publicAddress);
		const replacements = result.match(/(?:192\.0\.2|198\.51\.100|203\.0\.113)\.[0-9]+/g);
		expect(replacements).toHaveLength(2);
		expect(replacements?.[0]).toBe(replacements?.[1]);
	});

	it("normalizes broad public prefixes into RFC 5737 space", () => {
		const publicAddress = ["8", "8", "4", "4"].join(".");
		const result = sanitizePublicIpv4Examples(`prefix=${publicAddress}/8`);

		expect(result).toMatch(/(?:192\.0\.2|198\.51\.100|203\.0\.113)\.0\/24/);
	});

	it("preserves documentation, protocol, version, and SVG coordinate syntax", () => {
		const source = [
			"documentation=192.0.2.10",
			"shared=100.64.0.1",
			"multicast=224.0.0.251",
			"browserVersion=136.0.0.0",
			'<svg><path d="M0 0 4.254.141.138 Z"/></svg>',
		].join("\n");

		expect(sanitizePublicIpv4Examples(source)).toBe(source);
	});
});
