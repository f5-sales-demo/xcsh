import { expect, test } from "bun:test";
import { preparePropertyScope, rankPropertyScope, propertyTerms } from "./contrastive-ranking";
const row = (schema_path: string, description: string, anchor = "schema-" + schema_path.replaceAll(".", "--")) => ({
	provider_type: "resources",
	provider_name: "fixture",
	schema_path,
	path: `documentation/resources/fixture/${schema_path}/index.md`,
	anchor,
	description,
});
test("property ranking separates requested field evidence from ancestor context", () => {
	const scope = preparePropertyScope([
		row("routing.external.asn", "Autonomous System Number for BGP peer."),
		row("routing.external.port", "Peer TCP port number."),
		row("routing.external", "External routing configuration.", "section"),
	]);
	expect(
		rankPropertyScope("which property configures the autonomous system number for external routing", scope)[0]
			?.schema_path,
	).toBe("routing.external.asn");
});
test("contradictory branch evidence outweighs unrelated description overlap", () => {
	const scope = preparePropertyScope([
		row("routes.inside.ipv4.addr", "IPv4 address for static routes."),
		row("routes.outside.ipv6.addr", "IPv6 address for static routes."),
		row("routes.outside.ipv4.addr", "IPv4 address."),
	]);
	expect(rankPropertyScope("outside static routes IPv4 address", scope)[0]?.schema_path).toBe(
		"routes.outside.ipv4.addr",
	);
});
test("indistinguishable repeated branches retain equal evidence and deterministic ordering", () => {
	const scope = preparePropertyScope([
		row("mode_b.password.location", "Location URI for secret."),
		row("mode_a.password.location", "Location URI for secret."),
	]);
	const ranked = rankPropertyScope("password secret location URI", scope);
	expect(ranked[0]?.score).toBe(ranked[1]?.score);
	expect(ranked.map(r => r.schema_path)).toEqual(["mode_a.password.location", "mode_b.password.location"]);
	expect(rankPropertyScope("password secret location URI", scope)).toEqual(ranked);
});

test("HTTP encryption words do not imply a private-key storage mode", () => {
	expect(propertyTerms("unencrypted HTTP requests")).not.toContain("clear");
	expect(propertyTerms("encrypted backend traffic")).not.toContain("blindfold");
});

test("query synonyms and schema abbreviations share canonical terms", () => {
	expect(propertyTerms("regular expression patterns")).toEqual(propertyTerms("regex_values"));
	expect(propertyTerms("static IPv6 routes")).toEqual(propertyTerms("static_v6_routes"));
	expect(propertyTerms("ending IP address")).toEqual(propertyTerms("end_ip_address"));
});

test("out-of-vocabulary filler does not overwhelm documented field coverage", () => {
	const scope = preparePropertyScope([
		row("tls.port", "HTTPS listening port."),
		row("tls.timeout", "Connection timeout."),
	]);
	const direct = rankPropertyScope("HTTPS listening port", scope)[0]!;
	const verbose = rankPropertyScope("Kindly elucidate the HTTPS listening port", scope)[0]!;
	expect(verbose.coverage).toBe(direct.coverage);
	expect(rankPropertyScope("unseen invented widget", scope)[0]?.coverage).toBe(0);
});
