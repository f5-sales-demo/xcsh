import { expect, test } from "bun:test";
import {
	propertyRequestedText,
	propertyRequestedBlockText,
 propertyRequestsBlock,
 propertyRequestsRootField,
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

test("documented object lists and scalar lists retain their requested property level", () => {
 const scope=preparePropertyScope([{...row("rules","This can be used for messages where no values are needed.","section"),type:"object",nesting:"list"},{...row("rules.rule","Evaluation rule."),type:"string"},{...row("conditions.regex_values","Regular expression patterns."),type:"list",nesting:null},{...row("conditions","Matching conditions.","section"),type:"object",nesting:"single"}]);
 expect(rankPropertyScope("In xcsh_fixture, configure the list of rules",scope)[0]?.schema_path).toBe("rules");
 expect(rankPropertyScope("Which field sets a rule item in xcsh_fixture?",scope)[0]?.schema_path).toBe("rules.rule");
 expect(rankPropertyScope("In xcsh_fixture, specify the list of regular expression patterns",scope)[0]?.schema_path).toBe("conditions.regex_values");
});

test("one matching collection word does not outweigh the requested branch context", () => {
 const scope=preparePropertyScope([{...row("login.results.regex_values","A list of regular expressions matching input."),type:"list"},{...row("cluster.expressions","Kubernetes selector expressions."),type:"list"},{...row("login.results","Login transaction result conditions.","section"),type:"object",nesting:"list"}]);
 const rows=rankPropertyScope("In xcsh_fixture, specify the list of regular expression patterns for matching login transaction results",scope);
 expect(rows.findIndex(row=>row.schema_path==="login.results.regex_values")).toBeLessThan(rows.findIndex(row=>row.schema_path==="cluster.expressions"));
});

test("selector expressions do not imply regular expression matching", () => {
 expect(propertyTerms("Kubernetes selector expressions")).not.toContain("regex");
 expect(propertyTerms("regular expressions")).toContain("regex");
 expect(propertyQueryTerms("regular expression patterns")).toEqual(propertyTerms("regex_values"));
 const scope=preparePropertyScope([row("selector.expressions","Kubernetes style label expressions."),row("matching.regex_values","A list of regular expressions to match input.")]);
 expect(rankPropertyScope("regular expression patterns",scope)[0]?.schema_path).toBe("matching.regex_values");
 expect(rankPropertyScope("Kubernetes selector expressions",scope)[0]?.schema_path).toBe("selector.expressions");
});

test("argument and flag phrasing preserve requested values", () => {
 expect(propertyRequestedText("Which argument specifies the software version in xcsh_fixture action?")).toContain("software version");
 expect(propertyRequestedText("Which boolean flag enables automatic redirection in xcsh_fixture?")).toContain("automatic redirection");
});

test("field scope and trailing usage clauses remain separate from requested values",()=>{
 expect(propertyRequestedText("Which property in tls_settings specifies the certificate name used to authenticate backend connections?")).toBe("the certificate name");
 expect(propertyRequestedText("Which property under retry_settings sets the retry count when handling connection failures?")).toBe("the retry count");
 expect(propertyRequestedText("Which attribute provides the expiration timestamp at which the token will expire?")).toBe("the expiration timestamp");
});

test("field function verbs identify the returned or described value",()=>{
 expect(propertyRequestedText("Which computed attribute exposes the bearer token string?")).toBe("the bearer token string?");
 expect(propertyRequestedText("Which attribute returns the rendered manifest payload?")).toBe("the rendered manifest payload?");
 expect(propertyRequestedText("Which argument filters the region list?")).toBe("the region list?");
 expect(propertyRequestedText("Which attribute describes the hardware category?")).toBe("the hardware category?");
});

test("named block requests rank their target before surrounding resource context",()=>{
 const scope=preparePropertyScope([row("service","Service settings.","section"),row("service.routes.direct_response_route","Static reply settings.","section")]);
 expect(rankPropertyScope("In xcsh_fixture service, where do I declare a direct response route block to return status and body?",scope)[0]?.schema_path).toBe("service.routes.direct_response_route");
});

test("block target parsing separates purpose and identity",()=>{expect(propertyRequestedBlockText("In xcsh_fixture service, where do I declare a direct response route block to return status and body?")).toBe("a direct response route");expect(propertyRequestedBlockText("Which block retains all query parameters during URL redirection?")).toBe("retains all query parameters");});

test("explicit property type applies before ranking",()=>{
 const scope=preparePropertyScope([{...row("port","Traffic port."),type:"number"},{...row("redirect","Redirect traffic."),type:"bool"}]);
 expect(rankPropertyScope("Which boolean flag enables traffic redirect?",scope).map(row=>row.schema_path)).toEqual(["redirect"]);
});

test("schema plurals retain the same terms as their query counterparts",()=>{
 expect(propertyTerms("ipv4_prefixes")).toEqual(propertyQueryTerms("IPv4 prefixes"));
 expect(propertyTerms("retries")).toEqual(propertyTerms("retry"));
 expect(propertyTerms("policies")).toEqual(propertyTerms("policy"));
});

test("boolean predicate grammar preserves its documented subject and state",()=>{
 expect(propertyQueryTerms("whether the key is active")).toEqual(propertyQueryTerms("key active"));
 expect(propertyQueryTerms("whether a response should be blocked")).toEqual(propertyQueryTerms("response blocked"));
 expect(propertyQueryTerms("whether unsupported bandwidth is limited")).toContain("bandwidth");
});

test("block definition requests preserve the named target without item prose",()=>{
 expect(propertyRequestedBlockText("Where is the definition of the routes list block containing path rules in xcsh_fixture?")).toBe("routes");
 expect(propertyRequestedBlockText("Where is the definition of the resource block?")).toBeUndefined();
});

test("response criteria use condition vocabulary without implying a status code",()=>{
 expect(propertyQueryTerms("failure criteria")).toEqual(propertyQueryTerms("failure conditions"));
 const scope=preparePropertyScope([row("login.failure_conditions","Failure Conditions.","section"),row("login.failure_conditions.status","HTTP response status codes.")]);
 expect(rankPropertyScope("Define login failure criteria in xcsh_fixture",scope)[0]?.schema_path).toBe("login.failure_conditions");
 expect(rankPropertyScope("Which field sets response status code for login failure criteria?",scope)[0]?.schema_path).toBe("login.failure_conditions.status");
});

test("served hostnames mean domains while backend hostnames retain DNS identity",()=>{
 expect(propertyQueryTerms("active hostnames routed by the proxy")).toContain("domain");
 expect(propertyQueryTerms("hostnames served by the load balancer")).toContain("domain");
 expect(propertyQueryTerms("backend hostname")).toContain("dns");
});

test("filter argument requests distinguish criterion from returned collection",()=>{
 expect(propertyRequestedText("Which argument filters the CIDR block list by geographic region?")).toBe("geographic region?");
 expect(propertyRequestedText("Which field filters object results by namespace in xcsh_fixture?")).toBe("namespace");
 const scope=preparePropertyScope([row("regions","Regions to include when compiling the allowlist."),row("cidr_blocks","Compiled CIDR block list."),row("cidr_blocks_by_region","CIDR block list grouped by region.")]);
 expect(rankPropertyScope("Which argument filters CIDR blocks by regions?",scope)[0]?.schema_path).toBe("regions");
 expect(rankPropertyScope("Which attribute returns CIDR blocks grouped by region?",scope)[0]?.schema_path).toBe("cidr_blocks_by_region");
});

test("identifier arguments retain their value type and exclude invocation context",()=>{
 expect(propertyRequestedText("Which identifier argument specifies which object to remove when calling xcsh_fixture action?")).toBe("identifier which object to remove");
 expect(propertyRequestedText("Which field specifies retry count when invoking xcsh_fixture?")).toBe("retry count");
 const scope=preparePropertyScope([row("key_id","Unique identifier for this key."),row("zone_name","Name of the zone.")]);
 expect(rankPropertyScope("Which identifier argument specifies which key to remove when calling xcsh_fixture action?",scope)[0]?.schema_path).toBe("key_id");
});


test("direct destination-port requests retain root scope and endpoint meaning",()=>{
 expect(propertyRequestsRootField("Which direct attribute sets the destination port?")).toBe(true);
 expect(propertyRequestsRootField("Which attribute configures a direct response route?")).toBe(false);
 expect(propertyQueryTerms("default destination port")).toEqual(propertyQueryTerms("default endpoint port"));
 expect(propertyQueryTerms("destination repository URL")).toContain("destination");
});


test("classification questions retain type intent and their requested values",()=>{
 expect(propertyRequestedText("Which argument specifies whether it is a signing key or encryption key?")).toBe("type whether it is a signing key or encryption key?");
 expect(propertyRequestedText("Which field specifies whether retry is enabled?")).toBe("whether retry is enabled?");
 expect(propertyRequestedText("Which field specifies whether it is a fabricated widget or imaginary gadget?")).toContain("fabricated widget");
 const scope=preparePropertyScope([row("key_type","Type or category classification."),row("key_name","Name of the key.")]);
 expect(rankPropertyScope("Which argument specifies whether it is a signing key or encryption key?",scope)[0]?.schema_path).toBe("key_type");
});


test("proxy-served hostnames use documented host-authority matching without changing backend DNS",()=>{
 const scope=preparePropertyScope([row("domains","Domains matched by host/authority header to the load balancer."),row("csrf_policy.domains","Domain names used for CSRF header matching.")]);
 expect(rankPropertyScope("Which attribute returns hostnames served by the proxy?",scope)[0]?.schema_path).toBe("domains");
 expect(propertyQueryTerms("hostnames served by the proxy")).toContain("authority");
 expect(propertyQueryTerms("backend hostname DNS lookup")).not.toContain("authority");
 expect(propertyQueryTerms("CSRF Host header domains")).not.toContain("authority");
});


test("imperative property intent does not require a literal provider name",()=>{
 expect(propertyRequestedText("On a fixture proxy, specify regular expressions matching failed login responses")).toBe("regular expressions matching failed login responses");
 expect(propertyRequestedText("Specify the HTTP header name used to evaluate login failures")).toBe("the HTTP header name");
 expect(propertyRequestedText("Provide a fictional quantum widget in a load balancer")).toContain("fictional quantum widget");
 expect(propertyRequestedText("Declare an xcsh_fixture resource")).toBeUndefined();
 const scope=preparePropertyScope([row("login.failure_conditions.regex_values","Regular expressions to match the input."),row("login.failure_conditions","Failure conditions.","section")]);
 expect(rankPropertyScope("On a fixture proxy, specify regular expressions matching failed login responses",scope)[0]?.schema_path).toBe("login.failure_conditions.regex_values");
});


test("plural regular-expression values identify the scalar regex list",()=>{
 expect(propertyQueryTerms("list of regular expressions")).toEqual(propertyQueryTerms("regex_values"));
 expect(propertyQueryTerms("regular expression algorithm")).not.toContain("value");
 const scope=preparePropertyScope([row("login.failure_conditions.regex_values","List of regular expressions matching the input."),row("login.failure_conditions","Failure Conditions.","section")]);
 expect(rankPropertyScope("Specify regular expressions matching failed login responses",scope)[0]?.schema_path).toBe("login.failure_conditions.regex_values");
});


test("querying a named schema value retains field lookup intent",()=>{
 expect(propertyRequestedText("Query auto_host_rewrite on a public route in data source xcsh_fixture")).toContain("auto_host_rewrite");
 expect(propertyRequestedText("Query the existing object using data source xcsh_fixture")).toBeUndefined();
 const scope=preparePropertyScope([row("routes.auto_host_rewrite","Automatic host rewriting."),row("routes","Default route.","section")]);
 expect(rankPropertyScope("Query auto_host_rewrite on a public route in data source xcsh_fixture",scope)[0]?.schema_path).toBe("routes.auto_host_rewrite");
});


test("leading object queries preserve nested reads and remain object-level without a field",()=>{
 expect(propertyRequestedText("Query data source xcsh_fixture to read served domains")).toContain("served domains");
 expect(propertyRequestedText("Query the existing object using data source xcsh_fixture to read served domains")).toContain("served domains");
 expect(propertyRequestedText("Query an existing certificate using data source xcsh_fixture")).toBeUndefined();
});


test("query property phrases preserve modifiers and exclude object lookup",()=>{
 expect(propertyRequestedText("Query the name of an existing certificate using data source xcsh_fixture")).toBe("the name");
 expect(propertyRequestedText("Query the status of an existing gateway using data source xcsh_fixture")).toBe("the status");
 expect(propertyRequestedText("Query the service name of an existing gateway using data source xcsh_fixture")).toBe("the service name");
 expect(propertyRequestedText("Query an existing certificate using data source xcsh_fixture")).toBeUndefined();
 expect(propertyRequestedText("Query the existing object using data source xcsh_fixture to read served domains")).toContain("served domains");
});


test("nested explicit read wins over leading property lookup",()=>{expect(propertyRequestedText("Query the name of an existing object using data source xcsh_fixture to read served domains")).toContain("served domains");});


test("nested reads survive intervening object inspections and caller-only scope", () => {
 expect(propertyRequestedText("Query the name of an existing object using data source xcsh_fixture to inspect existing object to read served domains")).toBe("served domains");
 expect(propertyRequestedText("Query the name of an existing object to read served domains")).toBe("served domains");
});

test("nested reads preserve line boundaries and typed-object inspections", () => {
 expect(propertyRequestedText("Read served domains from data source xcsh_fixture.\nExplain the result.")).toBe("served domains");
 expect(propertyRequestedText("Query the name of an existing certificate using data source xcsh_fixture to inspect existing certificate to read served domains")).toBe("served domains");
});

test("trailing object inspections preserve the property-bearing request", () => {
 expect(propertyRequestedText("Read served domains from data source xcsh_fixture to inspect existing certificate")).toBe("served domains");
 expect(propertyRequestedText("Query the name of an existing certificate using data source xcsh_fixture to inspect existing certificate")).toBe("the name");
});

test("object inspections with articles do not replace explicit read or query", () => {
 expect(propertyRequestedText("Read served domains from data source xcsh_fixture to inspect the certificate")).toBe("served domains");
 expect(propertyRequestedText("Query the name of an existing certificate using data source xcsh_fixture to inspect the certificate")).toBe("the name");
 expect(propertyRequestedText("Inspect served domains using data source xcsh_fixture")).toBe("served domains");
});

test("explicit workload architecture excludes its parallel schema branch", () => {
 const candidates=["service", "stateful_service"].map(architecture => ({...row(`${architecture}.port`, "Listener port."),provider_name:"workload"}));
 expect(rankPropertyScope("stateless workload listener port",preparePropertyScope(candidates)).map(r=>r.schema_path)).toEqual(["service.port"]);
 expect(rankPropertyScope("stateful workload listener port",preparePropertyScope(candidates)).map(r=>r.schema_path)).toEqual(["stateful_service.port"]);
 expect(rankPropertyScope("workload listener port",preparePropertyScope(candidates))).toHaveLength(2);
 expect(rankPropertyScope("stateful or stateless workload listener port",preparePropertyScope(candidates))).toHaveLength(2);
});

test("qualified negation and examples do not become positive workload architecture", () => {
 const candidates=["service","stateful_service"].map(architecture=>({...row(`${architecture}.port`,"Listener port."),provider_name:"workload"}));
 expect(rankPropertyScope("workload port, not a stateful service",preparePropertyScope(candidates)).map(r=>r.schema_path)).toEqual(["service.port"]);
 expect(rankPropertyScope("workload port, not necessarily stateful",preparePropertyScope(candidates))).toHaveLength(2);
 expect(rankPropertyScope("workload port (for example service.public)",preparePropertyScope(candidates))).toHaveLength(2);
 expect(rankPropertyScope("workload port, not under service.public",preparePropertyScope(candidates))).toHaveLength(2);
});

test("configuration capability requests rank named blocks above incidental prose fields", () => {
 const scope=preparePropertyScope([
 row("enable_feature_discovery", "Settings for feature discovery.","section"),
 row("disable_feature_discovery", "No values needed.","section"),
 row("pool.connection_limit", "Maximum HTTP connections. Feature API details."),
 ]);
 const rows=rankPropertyScope("Set feature discovery on xcsh_fixture",scope);
 expect(["enable_feature_discovery", "disable_feature_discovery"]).toContain(rows[0]?.schema_path);
 expect(rows.find(x=>x.schema_path==="disable_feature_discovery")!.score).toBeGreaterThan(rows.find(x=>x.schema_path==="pool.connection_limit")!.score);
});

test("capability pairs cannot outrank a fully named scalar through the opposite block", () => {
 const scope=preparePropertyScope([row("enable_feature_discovery","Settings.","section"),row("disable_feature_discovery","Empty option.","section"),row("enable_feature_discovery.hostname","Hostname for discovery.")]);
 expect(rankPropertyScope("Configure xcsh_fixture feature discovery hostname",scope)[0]?.schema_path).toBe("enable_feature_discovery.hostname");
});

test("explicit field labels carry action value intent without operation narration", () => {
 expect(propertyRequestedText("Specify the target site name with site attribute when executing xcsh_fixture action.")).toBe("site");
 expect(propertyRequestedText("Specify the target release with software_version when running xcsh_fixture action.")).toBe("software_version");
 expect(propertyRequestedText("Specify the key_type attribute when adding a key in xcsh_fixture action.")).toBe("key_type");
});

test("type descriptions are not mistaken for explicit field labels",()=>{
 expect(propertyRequestedText("Specify the target port using numeric field in xcsh_fixture resource")).not.toBe("numeric");
});

test("cookie persistence configuration is a capability request, while explicit cookie fields stay scalar",()=>{
 expect(propertyRequestsBlock("Set up passive session persistence using an incoming HTTP cookie name")).toBe(true);
 expect(propertyRequestsBlock("Which field sets the cookie name for session persistence?")).toBe(false);
 expect(propertyQueryTerms("Configure cookie session persistence")).toContain("affinity");
});

test("cookie-persistence purpose cannot turn requested scalar port into a block",()=>{
 expect(propertyRequestsBlock("Specify the listening port to configure cookie persistence")).toBe(false);
});

test("cookie persistence does not swallow an explicit scalar or unrelated persistence terminology",()=>{
 expect(propertyRequestsBlock("Specify the listening port for cookie persistence")).toBe(false);
 expect(propertyQueryTerms("Configure database persistence")).toContain("persistence");
});

test("cookie terminology is local and purpose clauses cannot force block fallback",()=>{
 expect(propertyQueryTerms("Configure database persistence, plus cookie affinity")).toContain("persistence");
 expect(propertyRequestsBlock("Set the idle timeout to enable cookie persistence")).toBe(false);
});

test("idle timeout for cookie persistence stays scalar",()=>{expect(propertyRequestsBlock("Configure the idle timeout for cookie persistence")).toBe(false);});

test("plural cookie field requests remain scalar intent",()=>{expect(propertyRequestsBlock("Which fields configure cookie persistence?")).toBe(false);});


test("duration paraphrases preserve session limit meaning over session labels", () => {
 const scope=preparePropertyScope([row("session.duration_seconds","Maximum session duration in seconds."),row("session.session_name","Session name.")]);
 expect(rankPropertyScope("Which setting controls how long the session lasts?",scope)[0]?.schema_path).toBe("session.duration_seconds");
});


test("bare metal and unmanaged prose retain the documented branch terminology", () => {
 const scope=preparePropertyScope([row("baremetal.not_managed.node.dns_list","DNS server list."),row("aws.not_managed.node.dns_list","DNS server list.")]);
 expect(rankPropertyScope("Unmanaged bare metal node DNS server list",scope)[0]?.schema_path).toBe("baremetal.not_managed.node.dns_list");
 expect(propertyQueryTerms("unmanaged bare-metal nodes")).toEqual(expect.arrayContaining(["not","baremetal","node"]));
});


test("explicit workload public port count constrains candidates before ranking", () => {
 const a={...row("service.advertise_on_public.port.tls.port","Port."),provider_name:"workload"};
 const b={...row("service.advertise_on_public.multi_ports.ports.tls.port","Port."),provider_name:"workload"};
 expect(rankPropertyScope("stateless workload TLS port with one public port",preparePropertyScope([a,b])).map(r=>r.schema_path)).toEqual([a.schema_path]);
 expect(rankPropertyScope("stateless workload TLS port with public ports",preparePropertyScope([a,b]))).toHaveLength(2);
});


test("protocol slash forms share documented HTTP2 tokens", () => {
 expect(propertyQueryTerms("HTTP/2")).toContain("http2");
 expect(propertyRequestedText("Where do I write the custom block-page body?")).toBe("the custom block-page body?");
 expect(propertyRequestsBlock("Declare the response block")).toBe(true);
});


test("descriptive minimum version retains exact abbreviated field evidence", () => {
 const scope=preparePropertyScope([row("tls.custom_security.min_version","Minimum protocol version."),row("tls.custom_security.version","Protocol version.")]);
 expect(rankPropertyScope("Find the minimum TLS version",scope)[0]?.schema_path).toBe("tls.custom_security.min_version");
 expect(propertyQueryTerms("minimum TLS version")).toContain("min");
});


test("query vocabulary supplements schema abbreviations without changing original terms", () => {
 expect(propertyQueryTerms("credential maximum minimum decrypts inactive")).toEqual(expect.arrayContaining(["cred","credential","max","min","decryption","idle"]));
 const scope=preparePropertyScope([row("secret.decryption_provider","Decryption provider name."),row("secret.store_provider","Store provider name.")]);
 expect(rankPropertyScope("Locate the provider that decrypts secret bytes",scope)[0]?.schema_path).toBe("secret.decryption_provider");
});
