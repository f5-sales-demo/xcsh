import { expect, test } from "bun:test";
import {
	propertyRequestedText,
 propertyRequestsBlock,
	propertyQueryTerms,
	preparePropertyScope,
	propertyTerms,
	rankPropertyScope,
} from "./contrastive-ranking";

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

test("an explicitly named configuration block outranks incidental mention in another description", () => {
	const scope = preparePropertyScope([
		row("rule_list", "Ordered rules; use allow_list or deny_list for geographic matches.", "section"),
		row("allow_list", "List of sources matching criteria.", "section"),
	]);
	expect(
		rankPropertyScope("which configuration block configures the allow list rule set", scope)[0]?.schema_path,
	).toBe("allow_list");
});

test("provider names cannot erase a requested field sharing their vocabulary", () => {
	const scope = preparePropertyScope([
		{
			...row(
				"token",
				"Access token for the F5 Artifact Registry (FAR) This token can be used to authenticate with FAR when pulling related images for Kubernetes bot infrastructure.",
			),
			provider_name: "artifact_registry_token",
		},
		{ ...row("expiration_time", "Token expiration time."), provider_name: "artifact_registry_token" },
	]);
	const ranked = rankPropertyScope(
		"When requesting an ephemeral artifact registry token, which attribute provides the generated authentication token string?",
		scope,
	);
	expect(ranked[0]?.schema_path).toBe("token");
	expect(ranked[0]?.score).toBeGreaterThan(0);
});

test("documented compound names and schema abbreviations share branch terms", () => {
	expect(propertyTerms("ingress egress gateway")).toEqual(propertyTerms("ingress_egress_gw"));
	expect(propertyTerms("FlashArray")).toEqual(propertyTerms("flash_array"));
	expect(propertyTerms("request bodies")).toEqual(propertyTerms("request_body"));
	expect(propertyTerms("session identifiers")).toEqual(propertyTerms("session_ids"));
});

test("where-to-specify field requests prefer scalar destinations over enclosing blocks", () => {
	const scope = preparePropertyScope([
		row("dual_stack", "Dual-stack address represents IPv4 and IPv6 together.", "section"),
		row("dual_stack.ipv4.addr", "IPv4 Address in string form with dot-decimal notation."),
	]);
	expect(rankPropertyScope("Where do I specify the IPv4 address for dual-stack routing?", scope)[0]?.schema_path).toBe(
		"dual_stack.ipv4.addr",
	);
	expect(rankPropertyScope("Which configuration block selects dual stack?", scope)[0]?.schema_path).toBe("dual_stack");
});

test("query phrasing maps header removal and source NAT to indexed terminology", () => {
	expect(propertyQueryTerms("request headers to strip before forwarding")).toContain("remove");
	expect(propertyQueryTerms("prefixes for source network address translation")).toContain("snat");
	expect(propertyQueryTerms("permits cluster-scoped access")).toContain("permit");
});

test("address prefixes name a prefix field rather than an individual address", () => {
	expect(propertyQueryTerms("IP address prefixes")).toEqual(propertyQueryTerms("prefixes"));
});

test("field intent separates requested values from trailing configuration context", () => {
	expect(propertyRequestedText("How do I configure the listening port for a TLS frontend?")).toBe(
		"the listening port",
	);
	expect(propertyRequestedText("In a gateway, which numeric attribute specifies the retry count for a backend?")).toBe(
		"the retry count",
	);
	expect(propertyRequestedText("Which block configures TLS?")).toBeUndefined();
	expect(propertyRequestedText("Where do I set a maximum download bandwidth rate?")).toBe(
		"a maximum download bandwidth rate?",
	);
});

test("compound provider prose uses the indexed schema vocabulary", () => {
	expect(propertyQueryTerms("HTTP load balancer routes")).toEqual(propertyQueryTerms("http_loadbalancer routes"));
	expect(propertyQueryTerms("Application firewall blocking")).toEqual(propertyQueryTerms("app_firewall blocking"));
});

test("field function verbs keep requested values separate from enclosing configuration", () => {
    expect(propertyRequestedText("Which parameter configures the target host for redirection?")).toBe("the target host for redirection?");
    expect(propertyRequestedText("Which property controls the interval for polling?")).toBe("the interval for polling?");
    expect(propertyRequestedText("Which property determines the name for an external peer?")).toBe("the name");
    const scope=preparePropertyScope([row("service.port.target_port","Port the workload is listening on."),row("service.redirect_route.host_redirect","Host to redirect requests to.")]);
    expect(rankPropertyScope("In a workload resource defining a redirect route on a service port, which parameter configures the target host for redirection?",scope)[0]?.schema_path).toBe("service.redirect_route.host_redirect");
});

test("explicit provider imperative retains value intent over enclosing block evidence",()=>{
 const scope=preparePropertyScope([row("routing.dual_stack","Dual stack includes IPv4 and IPv6.","section"),row("routing.dual_stack.ipv4.addr","IPv4 Address.")]);
 const q="In xcsh_fixture, specify the dual-stack IPv4 address.";
 expect(propertyRequestedText(q)).toBeDefined();expect(rankPropertyScope(q,scope)[0]?.schema_path).toBe("routing.dual_stack.ipv4.addr");
});

test("resource container wording does not turn scalar values into block requests",()=>{
 expect(propertyRequestsBlock("Configure an IPv4 address in xcsh_fixture resource block")).toBe(false);
 expect(propertyRequestsBlock("Which schema block covers private key storage?")).toBe(true);
 expect(propertyRequestedText("Configure an IPv4 address in xcsh_fixture resource block")).toBeDefined();
});

test("explicit provider identity in trailing context cannot replace requested namespace",()=>{
 const scope=preparePropertyScope([row("namespace","Namespace where the resource is configured."),row("token","Computed access token.")]);
 expect(propertyRequestedText("Specify the namespace parameter when declaring xcsh_artifact_registry_token.")).not.toContain("artifact_registry_token");
 expect(rankPropertyScope("Specify the namespace parameter when declaring xcsh_artifact_registry_token.",scope)[0]?.schema_path).toBe("namespace");
});

test("lookup value phrases preserve requested fields without provider identity",()=>{
 expect(propertyRequestedText("Query xcsh_fixture data source to inspect the configured listen_port.")).toContain("listen_port");
 expect(propertyRequestedText("Read served domains from an edge distribution via xcsh_fixture data source.")).toContain("domains");
 expect(propertyRequestedText("Query xcsh_fixture data source")).toBeUndefined();
});

test("listener wording and plural prefixes share literal field vocabulary",()=>{
 expect(propertyQueryTerms("listening port")).toEqual(propertyTerms("listen_port"));
 expect(propertyQueryTerms("IPv4 prefixes")).toEqual(propertyTerms("ipv4_prefix"));
 const scope=preparePropertyScope([row("listen_port","Listening port."),row("tcp","TCP listener configuration.","section")]);
 expect(rankPropertyScope("Specify the listening port number in xcsh_fixture resource block",scope)[0]?.schema_path).toBe("listen_port");
});

test("trailing purpose and lookup context do not become requested field evidence",()=>{
 expect(propertyRequestedText("Specify the list of domains to handle HTTP traffic in xcsh_fixture resource")).toBe("the list of domains");
 expect(propertyRequestedText("Read the name attribute of an existing load balancer via xcsh_fixture data source")).toBe("the name attribute");
 expect(propertyRequestedText("Specify the namespace parameter when declaring xcsh_fixture")).toBe("the namespace parameter");
});

test("protocol and advertisement phrasing retain schema vocabulary",()=>{
 expect(propertyQueryTerms("mutual TLS")).toEqual(propertyTerms("mtls"));
 expect(propertyQueryTerms("custom advertised ports")).toEqual(propertyTerms("custom advertise ports"));
 expect(propertyQueryTerms("HTTP/1.1 protocol").sort()).toEqual(propertyTerms("http protocol v1").sort());
});

test("named configuration choices outrank incidental scalar descriptions",()=>{
 const scope=preparePropertyScope([row("round_robin","Enable this option.","section"),row("pool.loadbalancer_algorithm","Round robin load balancing algorithm.")]);
 expect(rankPropertyScope("Configure round robin balancing in xcsh_fixture",scope)[0]?.schema_path).toBe("round_robin");
 expect(rankPropertyScope("Which field specifies loadbalancer algorithm in xcsh_fixture",scope)[0]?.schema_path).toBe("pool.loadbalancer_algorithm");
});

test("enabling configuration choices remains distinct from explicit boolean fields",()=>{
 expect(propertyRequestsBlock("Disable CRL validation in xcsh_fixture")).toBe(true);
 expect(propertyRequestsBlock("Which boolean field disables xcsh_fixture?")).toBe(false);
});

test("passive field wording retains requested value without choosing a role",()=>{
 expect(propertyRequestedText("Where in BGP configuration is the autonomous system number specified for an external peer?")).toBe("the autonomous system number");
});

test("trailing purpose cannot rank an unrelated field over the requested domains",()=>{
 const scope=preparePropertyScope([row("domains","Host domains accepting traffic."),row("http_redirect","HTTP traffic redirection."),row("testing.domain","Testing domain.")]);
 expect(rankPropertyScope("Specify domains to handle HTTP traffic in xcsh_fixture",scope)[0]?.schema_path).toBe("domains");
});

test("matching a field name does not invent an unmentioned nested scope", () => {
 const scope = preparePropertyScope([
  row("labels", "Labels assigned to this object."),
  row("scan.labels.labels", "Labels matched when scanning."),
  row("policy.labels", "Labels matched by policy."),
 ]);
 expect(rankPropertyScope("In xcsh_fixture, specify labels", scope)[0]?.schema_path).toBe("labels");
 expect(rankPropertyScope("In xcsh_fixture, specify scan labels", scope)[0]?.schema_path).toBe("scan.labels.labels");
});

test("resolved provider identifiers and role wording do not become property evidence", () => {
 expect(propertyQueryTerms("Read labels via xcsh_fixture data source")).toEqual(propertyQueryTerms("Read labels via"));
 expect(propertyQueryTerms("Configure labels in xcsh_fixture managed resource declaration")).toEqual(propertyQueryTerms("Configure labels in"));
 const scope=preparePropertyScope([row("labels","Object labels."),row("data_source.labels","Labels used for a data source.")]);
 expect(rankPropertyScope("Read labels via xcsh_fixture data source",scope)).toEqual(rankPropertyScope("Read labels via",scope));
});

test("a literal unqualified requested field preserves direct object scope", () => {
 const scope=preparePropertyScope([row("name","Configuration object name."),row("receivers.name","Name of the object referenced by this configuration."),row("rules.metadata.name","Name of the object in metadata.")]);
 expect(rankPropertyScope("Read the name attribute of an existing object via xcsh_fixture data source",scope)[0]?.schema_path).toBe("name");
 expect(rankPropertyScope("Read the receiver name attribute via xcsh_fixture data source",scope)[0]?.schema_path).toBe("receivers.name");
});
