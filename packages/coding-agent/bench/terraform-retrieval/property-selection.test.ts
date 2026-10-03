import { expect, test } from "bun:test";
import { selectPropertyDestination } from "./property-selection";

const row = (schema_path: string, score: number, provider_type = "resources") => ({
	provider_type,
	provider_name: "fixture",
	schema_path,
	path: `documentation/${provider_type}/fixture/${schema_path}/index.md`,
	anchor: `schema-${schema_path.replaceAll(".", "--")}`,
	description: "Documented setting.",
	score,
	coverage: 0.8,
});
test("a large rank gap cannot decide an omitted repeated branch", () => {
	const rows = [row("inside.routes.address", 50), row("outside.routes.address", 10)];
	expect(selectPropertyDestination("set route address", rows).kind).toBe("choices");
	expect(selectPropertyDestination("set inside route address", rows).kind).toBe("leaf");
});
test("provider role collisions require role evidence even with separated ranks", () => {
	const rows = [row("tls.port", 50), row("tls.port", 10, "data-sources")];
	expect(selectPropertyDestination("TLS port", rows).kind).toBe("choices");
	expect(selectPropertyDestination("TLS port on managed resource", [rows[0]!]).kind).toBe("leaf");
});
test("unrelated high-ranking prose does not overcome absent field coverage", () => {
	expect(selectPropertyDestination("configure unseen option", [{ ...row("tls.port", 50), coverage: 0.1 }]).kind).toBe(
		"choices",
	);
});
test("close distinct fields remain choices and ties are deterministic", () => {
	const rows = [row("timeout", 30), row("idle_timeout", 29)];
	expect(selectPropertyDestination("adjust timeout", rows).kind).toBe("choices");
	expect(selectPropertyDestination("adjust timeout", rows)).toEqual(
		selectPropertyDestination("adjust timeout", rows.slice().reverse()),
	);
});
test("contradictory IP family and route side exclude alternatives", () => {
	const rows = [row("outside.ipv4.addr", 50), row("outside.ipv6.addr", 49), row("inside.ipv4.addr", 48)];
	expect(selectPropertyDestination("outside IPv4 address", rows).kind).toBe("leaf");
});

test("indexed collision alternatives protect against missing top-five branches", () => {
	const top = row("https_auto_cert.http_redirect", 50);
	const alternative = row("https.http_redirect", 1);
	expect(selectPropertyDestination("enable HTTP redirect to HTTPS", [top], [alternative]).kind).toBe("choices");
});

test("unrelated repeated field names do not require missing branch context", () => {
	const first = { ...row("listener.port", 50), description: "HTTPS listening port." };
	const other = { ...row("routing.port", 10), description: "BGP transport port." };
	expect(selectPropertyDestination("HTTPS listening port", [first], [other]).kind).toBe("leaf");
});

test("explicit dual-stack context excludes its otherwise identical single-stack destination", () => {
	const rows = [row("outside.dual_stack.ipv4.addr", 50), row("outside.ipv4.addr", 49)];
	expect(selectPropertyDestination("outside dual stack IPv4 address", rows).kind).toBe("leaf");
	expect(selectPropertyDestination("outside IPv4 address", rows).kind).toBe("choices");
});

test("unsupported explicit field identifiers cannot disappear from coverage", () => {
	expect(selectPropertyDestination("set invented_flag on TLS port", [row("tls.port", 50)]).kind).toBe("none");
	expect(selectPropertyDestination("set tls_port", [row("tls_port", 50)]).kind).toBe("leaf");
});

test("the enclosing block does not compete with a specifically requested direct field", () => {
	const field = row("tls.version", 40);
	const parent = { ...row("tls", 39), anchor: "section" };
	expect(selectPropertyDestination("TLS version field", [field, parent]).kind).toBe("leaf");
});
test("a complete multiword field name separates nearby sibling fields", () => {
	const total = row("limits.total_number", 40);
	const burst = row("limits.burst_multiplier", 39);
	expect(selectPropertyDestination("total maximum number of requests", [total, burst]).kind).toBe("leaf");
	expect(selectPropertyDestination("adjust request limits", [total, burst]).kind).toBe("choices");
});

test("exclusive branch terms distinguish shared multiword segments without requiring boilerplate", () => {
	const rows = [row("scheme_proxy_host_request_uri.cache_ttl", 50), row("scheme_proxy_host_uri.cache_ttl", 10)];
	expect(selectPropertyDestination("scheme proxy host request URI cache TTL", rows).kind).toBe("leaf");
	expect(selectPropertyDestination("proxy host URI cache TTL", rows).kind).toBe("choices");
});

test("explicit single-stack excludes dual-stack while omitted stack remains ambiguous", () => {
	const rows = [row("outside.ipv4.addr", 50), row("outside.dual_stack.ipv4.addr", 10)];
	expect(selectPropertyDestination("single-stack outside IPv4 address", rows).kind).toBe("leaf");
	expect(selectPropertyDestination("outside IPv4 address", rows).kind).toBe("choices");
});

test("provider-only evidence cannot justify an unrelated requested operation", () => {
	const candidate = {
		...row("token", 23, "ephemeral-resources"),
		provider_name: "artifact_registry_token",
		description: "Access token for the F5 Artifact Registry used to authenticate when pulling images.",
		coverage: 1,
	};
	expect(
		selectPropertyDestination(
			"Which attribute in an ephemeral artifact registry token sets a maximum download bandwidth rate limit?",
			[candidate],
		).kind,
	).toBe("choices");
	expect(
		selectPropertyDestination(
			"Which attribute in an ephemeral artifact registry token provides the authentication token?",
			[candidate],
		).kind,
	).toBe("leaf");
});

test("requested field evidence excludes trailing branch context while retaining unsupported operations", () => {
	const address = {
		...row("outside.ipv4.addr", 50),
		description: "IPv4 Address in string form with dot-decimal notation.",
	};
	expect(
		selectPropertyDestination("Which attribute sets the IPv4 next-hop address for custom outside static routes?", [
			address,
		]).kind,
	).toBe("leaf");
	const uri = {
		...row("flash_array.location", 50),
		description: "Location is the uri_ref. It could be in URL format.",
	};
	expect(
		selectPropertyDestination("Which attribute specifies the secret location URI for a FlashArray API token?", [uri])
			.kind,
	).toBe("leaf");
	expect(
		selectPropertyDestination("Which attribute specifies a Helm chart repository URL for deployment?", [uri]).kind,
	).toBe("choices");
});

test("documented schema context supports requested operations but provider words do not", () => {
	const address = {
		...row("routes.nexthop.nexthop_address.dual_stack.ipv4.addr", 50),
		description: "IPv4 Address in string form with dot-decimal notation.",
	};
	expect(
		selectPropertyDestination(
			"Which attribute sets the standard dual-stack IPv4 next-hop address for custom routes?",
			[address],
		).kind,
	).toBe("leaf");
	const token = {
		...row("token", 50),
		description: "Access token for the Artifact Registry.",
		provider_name: "artifact_registry_token",
	};
	expect(
		selectPropertyDestination("Which attribute sets a maximum download bandwidth rate limit?", [token]).kind,
	).toBe("choices");
});

test("strictly stronger requested-field evidence excludes incidental competing fields", () => {
	const end = { ...row("pools.end_ip", 42), description: "Ending IPv6 address of the pool range." };
	const mode = {
		...row("pool_settings", 38),
		description: "Address ranges in DHCP pool list are used for IP allocation.",
	};
	expect(
		selectPropertyDestination("Which parameter specifies the ending IPv6 address for a DHCP pool?", [end, mode]).kind,
	).toBe("leaf");
	const start = { ...row("pools.start_ip", 41), description: "Starting IPv6 address of the pool range." };
	expect(
		selectPropertyDestination("Which parameter specifies the IPv6 address for a DHCP pool?", [end, start]).kind,
	).toBe("choices");
});

test("branch terminology compares sibling segments rather than unrelated repeated ancestors", () => {
	const rows = [row("arrays.flash_array.token.location", 50), row("arrays.flash_blade.token.location", 10)];
	expect(selectPropertyDestination("FlashArray token location", rows).kind).toBe("leaf");
	expect(selectPropertyDestination("flash token location", rows).kind).toBe("choices");
});

test("explicit custom routes exclude the incompatible simple route choice", () => {
	const rows = [row("custom_static_route.ipv4.addr", 25), row("simple_static_route", 24)];
	expect(selectPropertyDestination("custom static route IPv4 address", rows).kind).toBe("leaf");
});

test("validated repeated leaf branches do not reintroduce a score-gap clarification", () => {
	const rows = [
		row("mobile.request_body_none.exact_value.case_insensitive", 42),
		row("web.request_body_none.exact_value.case_insensitive", 40),
	];
	expect(selectPropertyDestination("mobile request body none exact value case insensitive", rows).kind).toBe("leaf");
	expect(selectPropertyDestination("request body none exact value case insensitive", rows).kind).toBe("choices");
});

test("incidental API words cannot choose an omitted discovery architecture", () => {
	const rows = [
		row("enable_api_discovery.password.location", 50),
		row("single_lb_app.enable_discovery.password.location", 10),
	];
	expect(selectPropertyDestination("API discovery crawler password location", rows).kind).toBe("choices");
});

test("parallel named segments accept their distinguishing qualified term", () => {
	const mobile = row("protected_mobile_endpoints.request_body.exact_value.case_insensitive", 40);
	const web = row("protected_web_endpoints.request_body.exact_value.case_insensitive", 39);
	expect(
		selectPropertyDestination("protected mobile endpoints request body exact case insensitive", [mobile, web]).kind,
	).toBe("leaf");
	const v6 = row("slo.static_v6_routes.interface.name", 40);
	const plain = row("slo.static_routes.interface.name", 39);
	expect(selectPropertyDestination("SLO static IPv6 routes interface name", [v6, plain]).kind).toBe("leaf");
	const cache = row("scheme_proxy_host_request_uri.cache_ttl", 40);
	const other = row("scheme_proxy_host_uri.cache_ttl", 39);
	expect(selectPropertyDestination("proxy host request URI cache TTL", [cache, other]).kind).toBe("leaf");
	expect(selectPropertyDestination("proxy host URI cache TTL", [cache, other]).kind).toBe("choices");
});

test("commuted combinators retain missing nesting choice", () => {
	const a = row("cookies_none.cookie_operator.cookie.cookie_or.match.case_sensitive", 40);
	const b = row("cookies_or.cookie_operator.cookie.cookie_none.match.case_sensitive", 39);
	expect(selectPropertyDestination("cookies none using OR combination case sensitive", [a, b]).kind).toBe("choices");
});

test("named scalar field excludes its enclosing ancestor blocks", () => {
	const block = { ...row("dual_stack", 45), anchor: "section", description: "IPv4 and IPv6 address together." };
	const addr = { ...row("dual_stack.ipv4.addr", 35), description: "IPv4 address." };
	expect(
		selectPropertyDestination("Which attribute sets the dual-stack IPv4 address?", [block, addr]).destinations[0]
			?.schema_path,
	).toBe("dual_stack.ipv4.addr");
	expect(
		selectPropertyDestination("Which block selects dual stack?", [block, addr]).destinations[0]?.schema_path,
	).toBe("dual_stack");
});

test("reference-name intent excludes trailing usage context", () => {
	const named = { ...row("receivers.name", 40), description: "Name holds the referred object name." };
	const root = { ...row("name", 39), description: "Unique name of this configuration object." };
	expect(
		selectPropertyDestination("Which property specifies the receiver name referenced in alert delivery rules?", [
			named,
			root,
		]).kind,
	).toBe("leaf");
});

test("generic body terms do not specify a boolean operator branch", () => {
	const first = row("request_body.request_body_and.match.case_insensitive", 60);
	const other = row("request_body.request_body_none.match.case_insensitive", 1);
	expect(selectPropertyDestination("case insensitive exact matching on request body", [first], [other]).kind).toBe(
		"choices",
	);
	expect(selectPropertyDestination("case insensitive exact matching on request_body_and", [first], [other]).kind).toBe(
		"leaf",
	);
});

test("ordinary conjunctions cannot select logical schema operators", () => {
	const first = row("request_body.request_body_and.match.case_insensitive", 60);
	const other = row("request_body.request_body_none.match.case_insensitive", 1);
	expect(selectPropertyDestination("case insensitive request body and headers", [first], [other]).kind).toBe(
		"choices",
	);
	expect(selectPropertyDestination("case insensitive request body with AND operator", [first], [other]).kind).toBe(
		"leaf",
	);
});

test("requested reference name separates an upload URL while omitted intent remains undecided", () => {
	const first = { ...row("tls.verification.trusted_ca.name", 30), description: "Name of the referred object." };
	const upload = {
		...row("tls.verification.trusted_ca_url", 29),
		description: "Upload a CA certificate for verification.",
	};
	expect(
		selectPropertyDestination("Which attribute defines the name of the trusted CA object for verification?", [
			first,
			upload,
		]).kind,
	).toBe("leaf");
	expect(selectPropertyDestination("Configure trusted CA verification", [first, upload]).kind).toBe("choices");
});

test("qualified natural language names a boolean operator", () => {
	const none = row("request_body.request_body_none.match.case_insensitive", 60);
	const and = row("request_body.request_body_and.match.case_insensitive", 1);
	expect(selectPropertyDestination("none of the request bodies match case insensitive", [none], [and]).kind).toBe(
		"leaf",
	);
});

test("exclusive qualifier in unequal-depth sibling segments resolves branch context", () => {
	const first = row("stateful_service.advertise_custom.routes", 60);
	const other = row("stateful_service.advertise_on_public.multi_ports.routes", 1);
	expect(selectPropertyDestination("stateful service custom routes", [first], [other]).kind).toBe("leaf");
	expect(selectPropertyDestination("stateful service routes", [first], [other]).kind).toBe("choices");
});

test("imperative scalar requests exclude matching ancestor blocks",()=>{
 const rows=[{provider_type:"resources",provider_name:"fixture",schema_path:"routing.dual_stack",path:"block",anchor:"section",description:"Dual-stack IPv4 or IPv6 address.",score:60,coverage:1},{provider_type:"resources",provider_name:"fixture",schema_path:"routing.dual_stack.ipv4.addr",path:"field",anchor:"schema-field",description:"IPv4 address.",score:55,coverage:1}];
 expect(selectPropertyDestination("In xcsh_fixture, specify the dual-stack IPv4 address.",rows).destinations[0]?.path).toBe("field");
});

test("field function verbs cannot select an unrelated supported algorithm",()=>{
 const candidate={...row("default_pool.loadbalancer_algorithm",80),description:"Algorithm to distribute requests across backend servers.",coverage:0.6};
 for(const verb of ["configures","controls","determines"]){
  expect(selectPropertyDestination(`Which property ${verb} HTTP/3 BBR congestion control parameters?`,[candidate]).kind).toBe("choices");
 }
});

test("explicit schema segments constrain competing property candidates literally",()=>{
 const rows=[{...row("peers.external.asn",50),description:"Autonomous system number."},{...row("bgp_parameters.asn",49),description:"Autonomous system number."}];
 expect(selectPropertyDestination("Read ASN under bgp_parameters",rows).destinations[0]?.schema_path).toBe("bgp_parameters.asn");
 const repeated=[row("architecture_a.listen_port",50),row("architecture_b.listen_port",49)];
 expect(selectPropertyDestination("Read listen_port",repeated).kind).toBe("choices");
});

test("an explicitly requested block can be read before choosing its direct properties",()=>{
 const block={...row("primary",50),anchor:"section",description:"Primary DNS configuration."};const child={...row("primary.default_soa",49),anchor:"section",description:"Default SOA configuration."};
 expect(selectPropertyDestination("Read the primary schema block",[block,child]).destinations).toEqual([block]);
});

test("direct requested-field evidence separates incidental ancestor vocabulary",()=>{
 const rows=[{...row("listen_port",50),description:"Port accepting inbound connections."},{...row("advertise.listen_port.reference",49),description:"Reference to an object."}];
 expect(selectPropertyDestination("Which field specifies listening port?",rows).kind).toBe("leaf");
 const repeated=[{...rows[0]!,schema_path:"architecture_a.listen_port"},{...rows[0]!,schema_path:"architecture_b.listen_port",path:"peer"}];
 expect(selectPropertyDestination("Which field specifies listening port?",repeated).kind).toBe("choices");
});

test("a literal direct field request does not require choosing nested references", () => {
 const direct={...row("name",40),description:"Configuration object name."};
 const nested={...row("receivers.name",39),description:"Name of a referred configuration object."};
 expect(selectPropertyDestination("Read the name attribute of an existing object via xcsh_fixture data source",[direct,nested]).kind).toBe("leaf");
 expect(selectPropertyDestination("Read receiver name attribute via xcsh_fixture data source",[{...nested,score:50},direct]).destinations[0]?.schema_path).toBe("receivers.name");
});

test("enum examples are not mistaken for unsupported field identifiers",()=>{
 const field={...row("loadbalancer_algorithm",40),description:"Load balancing algorithm.",coverage:1};
 expect(selectPropertyDestination("Which field sets loadbalancer_algorithm (such as ROUND_ROBIN or LEAST_ACTIVE)?",[field]).kind).toBe("leaf");
 expect(selectPropertyDestination("Which field sets invented_algorithm?",[field]).kind).toBe("none");
});

test("explicit top-level field scope excludes nested reference fields",()=>{
 const root=row("name",30),nested=row("metadata.name",50);
 expect(selectPropertyDestination("Which top-level attribute specifies name?",[nested,root]).destinations[0]?.schema_path).toBe("name");
 expect(selectPropertyDestination("Which attribute specifies name?",[nested,root]).kind).toBe("choices");
});

test("explicit boolean flag type excludes numeric field evidence",()=>{
 const flag={...row("redirect",35),type:"bool",description:"Redirect traffic."};const port={...row("port",50),type:"number",description:"Incoming traffic port."};
 expect(selectPropertyDestination("Which boolean flag enables traffic redirect?",[port,flag]).destinations[0]?.schema_path).toBe("redirect");
});

test("generic service wording cannot choose stateless versus stateful architecture",()=>{
 const a={...row("service.ports.tls.default_security",50),anchor:"section"};const b={...row("stateful_service.ports.tls.default_security",1),anchor:"section"};
 expect(selectPropertyDestination("Which block selects default security for workload service ports?",[a],[b]).kind).toBe("choices");
 expect(selectPropertyDestination("Which block selects default security for stateless workload service ports?",[a],[b]).kind).toBe("leaf");
 expect(selectPropertyDestination("Which block selects default security for stateful service ports?",[b],[a]).kind).toBe("leaf");
});

test("explicit block targets do not require selecting incidental child fields",()=>{
 const parent={...row("routes",40),anchor:"section",coverage:0.2};const child={...row("routes.path",39),coverage:0.8};
 expect(selectPropertyDestination("Where is the definition of the routes list block containing path rules?",[parent,child]).kind).toBe("leaf");
 const peer={...parent,schema_path:"alternate.routes",path:"peer",score:1};
 expect(selectPropertyDestination("Where is the definition of the routes list block?",[parent],[peer]).kind).toBe("choices");
});

test("a filter criterion selects a documented input rather than computed output",()=>{
 const field={...row("regions",40),description:"Regions to include.",flags:["optional","computed"],coverage:0.15};const output={...row("cidr_blocks_by_region",15),description:"CIDRs grouped by region.",flags:["computed"],coverage:0.8};
 expect(selectPropertyDestination("Which argument filters CIDR blocks by geographic region?",[field,output]).kind).toBe("leaf");
 expect(selectPropertyDestination("Which argument filters CIDR blocks by unsupported vendor account?",[field,output]).kind).toBe("choices");
});


test("whole response criteria keep their section rather than forcing a child field", () => {
 const group={...row("login.failure_conditions",48),anchor:"section",description:"Failure Conditions.",type:"object",nesting:"list"};
 const status={...row("login.failure_conditions.status",42),description:"HTTP response status codes."};
 expect(selectPropertyDestination("Where do I define HTTP response criteria indicating login failure?",[group,status]).destinations[0]?.schema_path).toBe("login.failure_conditions");
 expect(selectPropertyDestination("Where do I define HTTP response criteria indicating login failure?",[group,status]).kind).toBe("leaf");
 expect(selectPropertyDestination("Which field sets HTTP response status in login failure criteria?",[status,group]).destinations[0]?.schema_path).toBe("login.failure_conditions.status");
 expect(selectPropertyDestination("Which field sets HTTP response status in login failure criteria?",[status,group]).kind).toBe("leaf");
 const unsupported={...row("login.credentials",48),anchor:"section",description:"Credentials.",type:"object",nesting:"list"};
 expect(selectPropertyDestination("Where do I define HTTP response criteria indicating login failure?",[unsupported,status]).kind).toBe("choices");
});
