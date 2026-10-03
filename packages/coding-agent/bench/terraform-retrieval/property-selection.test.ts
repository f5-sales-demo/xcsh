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
