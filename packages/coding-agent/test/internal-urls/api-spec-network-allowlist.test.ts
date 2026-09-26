import { describe, expect, it } from "bun:test";
import { createApiSpecResolver } from "../../src/internal-urls/api-spec-resolve";
import type { ApiSpecIndex, ApiSpecNetworkAllowlist } from "../../src/internal-urls/api-spec-types";
import type { InternalUrl } from "../../src/internal-urls/types";

function parseUrl(value: string): InternalUrl {
	const url = new URL(value) as InternalUrl;
	const match = value.match(/^xcsh:\/\/([^/?#]+)(\/[^?#]*)?/);
	url.rawHost = match?.[1] ?? "";
	url.rawPathname = match?.[2] ?? "/";
	return url;
}

const index: ApiSpecIndex = { version: "8.0.2", timestamp: "2026-09-25T00:00:00Z", domains: [] };
const allowlist: ApiSpecNetworkAllowlist = {
	sourceUrl: "https://docs.cloud.f5.com/ips-domains.json",
	sha256: "0".repeat(64),
	releaseVersion: "8.0.2",
	manifest: {
		manifest_type: "firewall_proxy_allowlist",
		services: {
			regional_edges: {
				regions: { americas: { ipv4_cidrs: Array.from({ length: 12 }, (_, i) => `192.0.2.${i}/32`) } },
			},
			bot_defense: { domains: ["bot.example.com"] },
		},
		customer_edge: { site_types: { secure_mesh_v2: { egress_domain_rules: { domains: [".example.com"] } } } },
	},
};

describe("API spec network allowlist", () => {
	it("renders bounded inventory with release provenance and exact counts", async () => {
		const result = await createApiSpecResolver(index, {}, undefined, undefined, allowlist).resolve(
			parseUrl("xcsh://api-spec/network-allowlist"),
		);
		expect(result.content).toContain("F5 XC Network Allowlist");
		expect(result.content).toContain("Release version: `8.0.2`");
		expect(result.content).toContain(allowlist.sourceUrl);
		expect(result.content).toContain(allowlist.sha256);
		expect(result.content).toContain("services.regional_edges.regions.americas.ipv4_cidrs");
		expect(result.content).toContain("12 values");
		expect(result.content).not.toContain("192.0.2.11/32");
		expect(result.content.length).toBeLessThan(8_000);
	});

	it("projects an exact object path without dumping unrelated manifest branches", async () => {
		const result = await createApiSpecResolver(index, {}, undefined, undefined, allowlist).resolve(
			parseUrl("xcsh://api-spec/network-allowlist?field=services.regional_edges"),
		);
		expect(result.content).toContain("Canonical field: `services.regional_edges`");
		expect(result.content).toContain("192.0.2.0/32");
		expect(result.content).not.toContain("bot.example.com");
	});

	it("returns exact follow-up URLs for ambiguous shorthand", async () => {
		const result = await createApiSpecResolver(index, {}, undefined, undefined, allowlist).resolve(
			parseUrl("xcsh://api-spec/network-allowlist?field=domains"),
		);
		expect(result.content).toContain("Ambiguous field: `domains`");
		expect(result.content).toContain("xcsh://api-spec/network-allowlist?field=services.bot_defense.domains");
		expect(result.content).toContain(
			"xcsh://api-spec/network-allowlist?field=customer_edge.site_types.secure_mesh_v2.egress_domain_rules.domains",
		);
		expect(result.content).not.toContain("bot.example.com");
	});

	it("does not add the allowlist extension to ordinary domain discovery", async () => {
		const result = await createApiSpecResolver(index, {}, undefined, undefined, allowlist).resolve(
			parseUrl("xcsh://api-spec/"),
		);
		expect(result.content).not.toContain("network-allowlist");
	});
});
