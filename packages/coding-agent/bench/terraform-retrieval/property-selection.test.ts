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


test("an explicit root scope uses requested value evidence without resource-purpose dilution", () => {
 const domains={...row("domains",30),coverage:0.15,type:"list",description:"Domain names matched by the load balancer."};
 expect(selectPropertyDestination("Which top-level attribute accepts the list of domain names that the proxy will service?",[domains]).kind).toBe("leaf");
 expect(selectPropertyDestination("Which top-level attribute accepts a Helm repository URL?",[domains]).kind).toBe("choices");
 expect(selectPropertyDestination("Which attribute accepts the list of domain names that the proxy will service?",[domains]).kind).toBe("choices");
});

test("workload architecture filters both ranked and indexed collision peers", () => {
 const a={...row("service.port",50), provider_name:"workload"};
 const b={...row("stateful_service.port",100), provider_name:"workload"};
 expect(selectPropertyDestination("stateless workload port",[b,a],[b]).destinations[0]?.schema_path).toBe("service.port");
 expect(selectPropertyDestination("stateful workload port",[a,b],[a]).destinations[0]?.schema_path).toBe("stateful_service.port");
 expect(selectPropertyDestination("workload port",[b,a]).kind).toBe("choices");
 expect(selectPropertyDestination("stateful or stateless workload port",[b,a]).kind).toBe("choices");
 expect(selectPropertyDestination("stateless workload port",[b],[]).kind).toBe("none");
});

test("workload architecture negation and identifier alternatives preserve intent", () => {
 const a={...row("service.port",50),provider_name:"workload"},b={...row("stateful_service.port",100),provider_name:"workload"};
 expect(selectPropertyDestination("workload port, not stateful",[a,b]).destinations[0]?.schema_path).toBe("service.port");
 expect(selectPropertyDestination("workload port, not stateless",[a,b]).destinations[0]?.schema_path).toBe("stateful_service.port");
 expect(selectPropertyDestination("stateless or stateful_service workload port",[a,b]).kind).toBe("choices");
 const other=[{...a,provider_name:"fixture"},{...b,provider_name:"fixture"}];
 expect(selectPropertyDestination("stateless or stateful service.port",other).kind).toBe("leaf");
});

test("mixed-provider architecture identifier policy is order-independent", () => {
 const a={...row("service.port",50),provider_name:"workload"},b={...row("stateful_service.port",100),provider_name:"workload"};
 const other={...row("stateful_service.port",10),provider_name:"fixture"};
 const query="stateless or stateful_service workload port";
 expect(selectPropertyDestination(query,[other,a,b])).toEqual(selectPropertyDestination(query,[b,a,other]));
 expect(selectPropertyDestination(query,[other,a,b]).kind).toBe("choices");
});

test("unresolved negative paths and examples remain architecture choices downstream", () => {
 const a={...row("service.port",50),provider_name:"workload"},b={...row("stateful_service.port",100),provider_name:"workload"};
 for(const query of ["workload port, not necessarily stateful", "workload port, not under stateful_service.public", "workload port, not stateful_service.public", "workload port without stateful", "workload port (e.g. stateful_service.public)", "workload port, not under service.public"])
 expect(selectPropertyDestination(query,[a,b]).kind).toBe("choices");
});

test("explicit architecture alternatives and article-qualified uncertainty stay undecided", () => {
 const a={...row("service.port",50),provider_name:"workload"},b={...row("stateful_service.port",100),provider_name:"workload"};
 for(const query of ["workload port under service.public or stateful_service.public", "workload port, not necessarily a stateful service", "workload port without a stateful service", "workload port, not a stateful_service.public"])
 expect(selectPropertyDestination(query,[a,b]).kind).toBe("choices");
});

test("negative and uncertain canonical paths preserve architecture alternatives", () => {
 const a={...row("service.port",50),provider_name:"workload"},b={...row("stateful_service.port",100),provider_name:"workload"};
 for(const query of ["workload port, not under a service.public path", "workload port, not under the stateful_service.public path", "workload port, not necessarily service.public", "workload port, not necessarily under service.public"])
 expect(selectPropertyDestination(query,[a,b]).kind).toBe("choices");
});

test("architecture guards apply to architecture clauses rather than unrelated constraints", () => {
 const a={...row("service.port",50),provider_name:"workload"},b={...row("stateful_service.port",100),provider_name:"workload"};
 for(const query of ["workload port, not under service", "workload port, not under stateful_service", "workload port, not under `service`"])
 expect(selectPropertyDestination(query,[a,b]).kind).toBe("choices");
 expect(selectPropertyDestination("stateless workload port without host rewriting",[a,b]).destinations[0]?.schema_path).toBe("service.port");
 expect(selectPropertyDestination("stateful workload port, not necessarily public",[a,b]).destinations[0]?.schema_path).toBe("stateful_service.port");
});

test("negative architecture clauses accept varied prepositions without guessing", () => {
 const a={...row("service.port",50),provider_name:"workload"},b={...row("stateful_service.port",100),provider_name:"workload"};
 for(const query of ["workload port, not in service.public", "workload port, not in stateful_service.public", "workload port, not necessarily in stateful_service.public", "workload port, not within the service branch"])
 expect(selectPropertyDestination(query,[a,b]).kind).toBe("choices");
});

test("negative architecture clauses preserve punctuation case and long scope", () => {
 const a={...row("service.port",50),provider_name:"workload"},b={...row("stateful_service.port",100),provider_name:"workload"};
 for(const query of ["workload port, not necessarily stateful, please", "workload port, not in the selected public listener configuration for stateful_service.public", "workload port WITHOUT stateful"])
 expect(selectPropertyDestination(query,[a,b]).kind).toBe("choices");
 expect(selectPropertyDestination("stateless workload port without host rewriting for the service",[a,b]).destinations[0]?.schema_path).toBe("service.port");
});

test("architecture token quoting and clause boundaries preserve actual intent", () => {
 const a={...row("service.port",50),provider_name:"workload"},b={...row("stateful_service.port",100),provider_name:"workload"};
 expect(selectPropertyDestination("workload port, not `stateful`",[a,b]).destinations[0]?.schema_path).toBe("service.port");
 expect(selectPropertyDestination("workload port, not `stateless`",[a,b]).destinations[0]?.schema_path).toBe("stateful_service.port");
 expect(selectPropertyDestination("workload port without host rewriting, stateful",[a,b]).destinations[0]?.schema_path).toBe("stateful_service.port");
 expect(selectPropertyDestination("workload port under the service branch or stateful_service branch",[a,b]).kind).toBe("choices");
});

test("conflicting positive and negative architecture assertions stay undecided", () => {
 const a={...row("service.port",50),provider_name:"workload"},b={...row("stateful_service.port",100),provider_name:"workload"};
 expect(selectPropertyDestination("stateful workload port; not stateful",[a,b]).kind).toBe("choices");
 expect(selectPropertyDestination("stateless workload port; not stateless",[a,b]).kind).toBe("choices");
});

test("canonical architecture alternatives support in and within branch wording", () => {
 const a={...row("service.port",50),provider_name:"workload"},b={...row("stateful_service.port",100),provider_name:"workload"};
 for(const query of ["workload port in the service branch or stateful_service branch","workload port within the service branch or stateful_service branch"]) expect(selectPropertyDestination(query,[a,b]).kind).toBe("choices");
});

test("canonical branch nouns and descriptive negative architecture clauses remain ambiguous", () => {
 const a={...row("service.port",50),provider_name:"workload"},b={...row("stateful_service.port",100),provider_name:"workload"};
 expect(selectPropertyDestination("workload port: service branch or stateful_service branch",[a,b]).kind).toBe("choices");
 expect(selectPropertyDestination("workload port, not a service that is stateful",[a,b]).kind).toBe("choices");
});

test("capability enable-disable requests preserve the caller's explicit choice", () => {
 const a={...row("enable_feature_discovery",50),anchor:"section"},b={...row("disable_feature_discovery",90),anchor:"section"};
 expect(selectPropertyDestination("set feature discovery",[a,b]).kind).toBe("choices");
 expect(selectPropertyDestination("set enable_feature_discovery",[a,b]).destinations[0]?.schema_path).toBe(a.schema_path);
 expect(selectPropertyDestination("enable or disable feature discovery",[a,b]).kind).toBe("choices");
});

test("fully named scalar intent is not replaced by capability block choices", () => {
 const field={...row("enable_feature_discovery.hostname",100),coverage:1};
 const a={...row("enable_feature_discovery",1),anchor:"section"},b={...row("disable_feature_discovery",1),anchor:"section"};
 expect(selectPropertyDestination("Configure xcsh_fixture feature discovery hostname",[field,a,b]).destinations[0]?.schema_path).toBe(field.schema_path);
});

test("capability pairs cannot cross provider identity or role", () => {
 const a={...row("enable_feature_discovery",50),anchor:"section"},b={...row("disable_feature_discovery",49,"data-sources"),anchor:"section"};
 expect(selectPropertyDestination("set feature discovery",[a,b]).reason).not.toBe("Missing enable or disable choice");
 expect(selectPropertyDestination("set feature discovery",[a,{...b,provider_type:"resources",provider_name:"other"}]).reason).not.toBe("Missing enable or disable choice");
});

test("capability polarity recognizes enabling and disabling inflections", () => {
 const a={...row("enable_feature_discovery",20),anchor:"section"},b={...row("disable_feature_discovery",100),anchor:"section"};
 expect(selectPropertyDestination("Configure disabling feature discovery",[a,b]).reason).not.toBe("Missing enable or disable choice");
 expect(selectPropertyDestination("Configure enabling feature discovery",[{...a,score:100},{...b,score:20}]).reason).not.toBe("Missing enable or disable choice");
});

test("an exact object identity query selects direct fields despite unrelated context", () => {
 const root={...row("name",30,"data-sources"),description:"Configuration object name.",coverage:0.1};
 const nested={...row("policy.query_parameter.query_param_name",29,"data-sources"),description:"Masks query parameter name."};
 expect(selectPropertyDestination("Query the name of an existing policy using data source xcsh_fixture",[root,nested]).kind).toBe("leaf");
 expect(selectPropertyDestination("Query the service name of an existing policy using data source xcsh_fixture",[root,nested]).kind).not.toBe("leaf");
 const resource={...root,provider_type:"resources"};
 expect(selectPropertyDestination("Query the name of an existing object",[root,resource]).kind).toBe("choices");
});

test("explicit field labels preserve nested qualifiers and role peers before type filtering",()=>{
 const root={...row("name",50,"data-sources"),type:"string"},nested={...row("service.name",49,"data-sources"),type:"string"};
 expect(selectPropertyDestination("Specify the name within service with name attribute in xcsh_fixture data source",[root,nested]).kind).not.toBe("leaf");
 const peer={...root,provider_type:"resources",type:"number"};
 expect(selectPropertyDestination("Which string field specifies name?",[root,peer]).kind).toBe("choices");
});

test("in a named schema branch cannot select an unrelated root field",()=>{
 const root={...row("name",50,"data-sources"),type:"string"},nested={...row("service.name",49,"data-sources"),type:"string"};
 expect(selectPropertyDestination("Specify the name in service using name attribute in xcsh_fixture data source",[root,nested]).kind).not.toBe("leaf");
});

test("resource field labels retain noun-qualified nested scope",()=>{
 const root={...row("name",50,"data-sources")},nested={...row("service.name",49,"data-sources")};
 expect(selectPropertyDestination("Specify the service name using name attribute in xcsh_fixture data source",[root,nested]).kind).not.toBe("leaf");
});

test("incidental action narration cannot erase resource noun scope",()=>{
 const root={...row("name",50)},nested={...row("service.name",49)};
 expect(selectPropertyDestination("Specify the service name using name attribute in xcsh_fixture resource before executing an action",[root,nested]).kind).not.toBe("leaf");
});

test("explicit dotted schema scope excludes reordered peers and retains unsupported path rejection",()=>{
 const a=row("alpha.beta.port",30),b=row("beta.alpha.port",100);
 expect(selectPropertyDestination("Which field sets port under alpha.beta?",[b,a],[b]).destinations[0]?.schema_path).toBe(a.schema_path);
 expect(selectPropertyDestination("Which field sets port under alpha.missing?",[b,a]).kind).toBe("none");
});

test("alternative and negative dotted paths cannot decide a leaf by score gap",()=>{
 const rows=[row("alpha_one.beta_two.port",100),row("gamma_three.delta_four.port",10)];
 for(const q of ["port under alpha_one.beta_two or under gamma_three.delta_four","port under alpha_one.beta_two and under gamma_three.delta_four","port not under alpha_one.beta_two"])
 expect(selectPropertyDestination(q,rows).kind).toBe("choices");
});

test("path alternatives retain ordinary contradiction exclusions",()=>{
 const rows=[row("outside.ipv4.addr",100),row("outside.ipv6.addr",50),row("inside.ipv4.addr",40)];
 expect(selectPropertyDestination("outside IPv4 address not under alpha.beta",rows).destinations.map(r=>r.schema_path)).toEqual(["outside.ipv4.addr"]);
});

test("repeated leaf words in ancestors cannot defeat explicit parent capability context",()=>{
 const a={...row("protection.policy.mobile_sdk_config",100),anchor:"section",description:"Mobile SDK configuration."};
 const b={...row("advanced_protection.both_web_and_mobile.mobile_sdk_config",95),anchor:"section",description:"Mobile identifier headers."};
 expect(selectPropertyDestination("Configure mobile_sdk_config in protection policy on xcsh_fixture",[a,b]).kind).toBe("leaf");
 expect(selectPropertyDestination("Configure mobile_sdk_config in protection policy on xcsh_fixture",[a,b]).destinations[0]?.schema_path).toBe(a.schema_path);
 expect(selectPropertyDestination("Configure mobile_sdk_config on xcsh_fixture",[a,b]).kind).toBe("choices");
 expect(selectPropertyDestination("Configure mobile_sdk_config for policy and web on xcsh_fixture",[a,b]).kind).toBe("choices");
});


test("a directly named field is distinct from every enclosing schema section", () => {
 const field={...row("policy.login.success_conditions.regex_values",40),description:"Regular expression values."};
 const parent={...row("policy.login",39),anchor:"section",description:"Login success conditions regular expression values."};
 expect(selectPropertyDestination("Which field sets regex values for login success conditions?",[field,parent]).kind).toBe("leaf");
 const sibling={...row("policy.login.failure_conditions.regex_values",38),description:field.description};
 expect(selectPropertyDestination("Which field sets regex values for login conditions?",[field,parent,sibling]).kind).toBe("choices");

});


test("lookup alone cannot distinguish an enclosing block from its size field", () => {
 const field={...row("memory.allocation.size",40),description:"Allocation size."};
 const parent={...row("memory.allocation",39),anchor:"section",description:"Memory allocation settings."};
 expect(selectPropertyDestination("Locate memory allocation",[field,parent]).kind).toBe("choices");
 expect(selectPropertyDestination("Locate memory allocation, not a field.",[field,parent]).kind).toBe("choices");
 expect(selectPropertyDestination("Locate memory allocation; the field is optional.",[field,parent]).kind).toBe("choices");
 expect(selectPropertyDestination("Which field specifies memory allocation size?",[field,parent]).kind).toBe("leaf");
});


test("partial leaf evidence excludes only ancestors and preserves conflicting leaf siblings", () => {
 const field={...row("event.results.pattern_entries",40),description:"Regular expression patterns."};
 const parent={...row("event.results",39),anchor:"section",description:"Event result pattern configuration."};
 expect(selectPropertyDestination("Locate event result pattern",[field,parent]).kind).toBe("leaf");
 const sibling={...row("event.other.pattern_entries",38),description:field.description};
 expect(selectPropertyDestination("Locate event pattern",[field,parent,sibling]).kind).toBe("choices");
});


test("bare dotted lookup targets reject unsupported paths before ranking certainty", () => {
 const field={...row("calibration.offset",40),description:"Calibration offset."};
 expect(selectPropertyDestination("Locate calibration.missing.",[field]).kind).toBe("none");
 expect(selectPropertyDestination("Locate calibration.offset.",[field]).kind).toBe("leaf");
});


test("all direct lookup forms retain unsupported literal path rejection", () => {
 const field={...row("calibration.offset",40),description:"Calibration offset."};
 for(const prefix of ["Where is","Where do I put","I need","Locate"]) expect(selectPropertyDestination(`${prefix} calibration.missing.`,[field]).kind).toBe("none");
});


test("placement literal paths remain unsupported across question inflections", () => {
 const field={...row("calibration.offset",40),description:"Calibration offset."};
 for(const prefix of ["Where does","Where do"])expect(selectPropertyDestination(`${prefix} calibration.missing go?`,[field]).kind).toBe("none");
});


test("named negative branch scope cannot select an excluded identifier", () => {
 const direct=row("policy.action",40), nested=row("detection_settings.policy.action",100);
 expect(selectPropertyDestination("Find the action outside detection_settings",[nested,direct]).destinations[0]?.schema_path).toBe(direct.schema_path);
 expect(selectPropertyDestination("Find the action inside detection_settings",[nested,direct]).destinations[0]?.schema_path).toBe(nested.schema_path);
 expect(selectPropertyDestination("Find the action inside and outside detection_settings",[nested,direct]).kind).not.toBe("leaf");
});


test("negated exclusions and positive-negative branch conflicts cannot invent scope", () => {
 const direct=row("policy.action",40), nested=row("detection_settings.policy.action",100);
 expect(selectPropertyDestination("Find action not outside detection_settings",[nested,direct]).kind).toBe("choices");
 expect(selectPropertyDestination("Find action inside detection_settings; excluding detection_settings",[nested,direct]).kind).toBe("choices");
 expect(selectPropertyDestination("Find action (for example outside detection_settings)",[nested,direct]).kind).toBe("choices");
});


test("named exclusion scope shares quote example and coordination interpretation", () => {
 const direct=row("policy.action",40), nested=row("detection_settings.policy.action",100);
 for(const query of ["Find action inside `detection_settings`; excluding detection_settings","Find action outside and inside detection_settings","Find action not always outside detection_settings"])expect(selectPropertyDestination(query,[nested,direct]).kind).toBe("choices");
 expect(selectPropertyDestination("Find action outside detection_settings (for example inside detection_settings)",[nested,direct]).destinations[0]?.schema_path).toBe(direct.schema_path);
 expect(selectPropertyDestination("Find action outside detection_settings-bogus",[nested,direct]).kind).toBe("none");
});


test("one public port retains single-port architecture against multi-port peers", () => {
 const a={...row("service.advertise_on_public.port.https.certificate_url",40),provider_name:"workload"};
 const b={...row("service.advertise_on_public.multi_ports.ports.https.certificate_url",100),provider_name:"workload"};
 expect(selectPropertyDestination("stateless workload HTTPS certificate URL on one public port",[b,a]).destinations[0]?.schema_path).toBe(a.schema_path);
 expect(selectPropertyDestination("stateless workload HTTPS certificate URL on public ports",[b,a]).kind).toBe("choices");
});


test("public port count cannot be inferred from negation or alternative counts", () => {
 const a={...row("service.advertise_on_public.port.tls.port",40),provider_name:"workload"};
 const b={...row("service.advertise_on_public.multi_ports.ports.tls.port",100),provider_name:"workload"};
 for(const q of ["stateless workload port with one or multiple public ports","stateless workload port not necessarily on one public port","stateless workload port (for example one public port)"])expect(selectPropertyDestination(q,[a,b]).kind).toBe("choices");
 expect(selectPropertyDestination("stateless workload TLS port with multiple public ports",[a,b]).destinations[0]?.schema_path).toBe(b.schema_path);
});


test("negated public port counts cannot select rejected workload architecture", () => {
 const a={...row("service.advertise_on_public.port.tls.port",40),provider_name:"workload"};
 const b={...row("service.advertise_on_public.multi_ports.ports.tls.port",100),provider_name:"workload"};
 for(const q of ["stateless workload TLS port no single public port","stateless workload TLS port never on one public port"])expect(selectPropertyDestination(q,[a,b]).kind).toBe("choices");
 for(const token of ["detection_settings/foo","detection_settings:bogus"])expect(selectPropertyDestination("Find action outside "+token,[row("detection_settings.action",40)]).kind).toBe("none");
});


test("trailing excluded branch punctuation cannot become positive scope", () => {
 const field=row("detection_settings.action",40);
 for(const q of ["Where do I write action outside detection_settings/","How do I pass action outside detection_settings:"])expect(selectPropertyDestination(q,[field]).kind).toBe("none");
});


test("explicit grouping requires documented keyed-map evidence", () => {
 const flat={...row("values",39),description:"Values across regions.",type:"list"};
 const keyed={...row("values_by_region",40),description:"Values keyed by region.",type:"map"};
 expect(selectPropertyDestination("Locate values grouped by region",[keyed,flat]).kind).toBe("leaf");
 expect(selectPropertyDestination("Locate values grouped by unknown category",[keyed,flat]).kind).not.toBe("leaf");
});


test("negated and alternative grouping keys require clarification", () => {
 const a={...row("values_by_region",40),description:"Values keyed by region.",type:"map"};
 const b={...row("values_by_zone",39),description:"Values keyed by zone.",type:"map"};
 for(const q of ["Locate values not grouped by region","Locate values grouped by region or zone"])expect(selectPropertyDestination(q,[a,b]).kind).not.toBe("leaf");
});


test("grouping cannot hide an unresolved provider role", () => {
 const resource={...row("values_by_region",40),type:"map",description:"Values keyed by region."};
 const data={...resource,provider_type:"data-sources",path:"data",score:39};
 expect(selectPropertyDestination("Locate values grouped by region",[resource,data]).kind).toBe("choices");
});


test("grouping keys require exact documented relationships and preserve role ambiguity", () => {
 const r={...row("values",40),type:"map",description:"Values keyed by region."};
 for(const key of ["`region`","\"region\""])expect(selectPropertyDestination(`Locate values grouped by ${key}`,[r]).kind).toBe("leaf");
 expect(selectPropertyDestination("Locate values grouped by region code",[r]).kind).not.toBe("leaf");
 expect(selectPropertyDestination("Locate values grouped by region_code",[{...r,description:"Values keyed by region code."}]).kind).toBe("leaf");
 const other={...r,description:"Keyed by service name; values contain region information."};
 expect(selectPropertyDestination("Locate values grouped by region",[other]).kind).not.toBe("leaf");
 for(const q of ["Locate values never grouped by region","Locate values grouped by region, not region"])expect(selectPropertyDestination(q,[r]).kind).toBe("choices");
 expect(selectPropertyDestination("Locate values grouped by region",[r,{...r,provider_type:"data-sources",type:"list",path:"data"}]).kind).toBe("choices");
});


test("numeric cap intent excludes an empty unlimited choice while omitted type stays ambiguous", () => {
 const number={...row("max_requests_per_connection",40),type:"number"};
 const unlimited={...row("no_request_limit_per_connection",39),type:"object"};
 expect(selectPropertyDestination("Locate the numeric cap on requests per connection",[number,unlimited]).destinations[0]?.schema_path).toBe(number.schema_path);
 expect(selectPropertyDestination("Locate the numeric cap on requests per connection",[number,unlimited]).kind).toBe("leaf");
 expect(selectPropertyDestination("Locate request limits",[number,unlimited]).kind).toBe("choices");
});


test("negated numeric cap wording cannot discard the object alternative", () => {
 const number={...row("max_requests",40),type:"number"};
 const unlimited={...row("no_request_limit",39),type:"object"};
 expect(selectPropertyDestination("Locate request limits, not a numeric cap",[number,unlimited]).kind).not.toBe("leaf");
});

test("numeric type evidence must be affirmative rather than optional or rejected", async () => {
 const { propertyRequestedType } = await import("../../src/internal-urls/terraform-property-ranking");
 const number={...row("max_requests_per_connection",40),type:"number",description:"Maximum requests per connection."};
 const unlimited={...row("no_request_limit_per_connection",39),type:"object",description:"No limit on requests per connection."};
 for(const q of [
  "Locate request limits instead of a numeric cap on requests per connection",
  "Locate request limits, never a numeric cap",
  "Locate a numeric cap or an unlimited choice on requests per connection",
  "Locate request limits (for example a numeric cap on requests per connection)",
  "Maybe locate a numeric cap",
  "Locate the numeric cap or boolean flag",
 ]) {
  expect(propertyRequestedType(q)).toBeUndefined();
  expect(selectPropertyDestination(q,[number,unlimited]).destinations.some(r=>r.type==="object")).toBe(true);
 }
 expect(propertyRequestedType("Locate the numeric cap on requests per connection")).toBe("number");
});

test("numeric assertions isolate examples and unrelated conjunctions", async () => {
 const {propertyRequestedType}=await import("../../src/internal-urls/terraform-property-ranking");
 for(const q of ["Locate request limits, for example a numeric cap","Locate an optional numeric cap","Locate request limits, such as a numeric cap","Locate a numeric cap or a boolean flag"])expect(propertyRequestedType(q)).toBeUndefined();
 for(const q of ["Locate a numeric cap on requests and connections","Locate a numeric cap. No TLS configuration needed.","Locate a numeric cap on requests or connections"])expect(propertyRequestedType(q)).toBe("number");
});

test("trailing numeric rejection preserves alternatives",async()=>{
 const {propertyRequestedType}=await import("../../src/internal-urls/terraform-property-ranking");
 expect(propertyRequestedType("Locate request limits, a numeric cap is not needed")).toBeUndefined();
});
