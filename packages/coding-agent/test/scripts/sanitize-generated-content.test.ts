import { describe, expect, it } from "bun:test";
import { sanitizePublicIpv4Examples } from "../../scripts/sanitize-generated-content";

describe("generated-content sanitization", () => {
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
