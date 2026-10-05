import { expect, test } from "bun:test";
import {
	boundedTerraformResponse,
	rankTerraformDirectProperties,
	rankTerraformProviderNames,
	scoreTerraformAliasContext,
	selectTerraformCandidate,
	type TerraformMetadata,
	terraformKnownQueryTerms,
	terraformNamedChoice,
	terraformProviderMention,
	terraformProviderSetupDestination,
	terraformQueryIdentity,
	terraformScopedSearchQuery,
	terraformTaskDestination,
	terraformTimeoutOperations,
	validateTerraformRetrievalMetadata,
} from "../../src/internal-urls/terraform-documentation";

import { propertyRequestedText } from "../../src/internal-urls/terraform-property-ranking";

const metadata = (): TerraformMetadata => ({
	id: "fixture",
	canonical_id: "fixture",
	path: "documentation/resources/fixture/index.md",
	provider_type: "resources",
	provider_name: "fixture",
	role: "properties",
	schema_path: ["tls"],
	summary: "TLS",
	aliases: [],
	parent_id: null,
	child_ids: [],
	retrieval_version: 1,
	category: "security",
	capabilities: ["security.tls"],
	tasks: ["configuration"],
	sections: [],
	relationships: [],
});

test("retrieval metadata rejects unsupported versions and malformed facets", () => {
	for (const change of [
		{ retrieval_version: 2 },
		{ category: 8 },
		{ capabilities: "security" },
		{ tasks: ["probability"] },
		{ sections: [{}] },
		{
			relationships: [
				{ type: "requires", target_id: "missing", anchor: "section", enforcement: "description", source: "hint" },
			],
		},
	]) {
		expect(() => validateTerraformRetrievalMetadata({ ...metadata(), ...change } as TerraformMetadata)).toThrow();
	}
	expect(() => validateTerraformRetrievalMetadata(metadata())).not.toThrow();
});

test("bounded discovery preserves UTF-8 entries and continuation destinations", () => {
	const content = boundedTerraformResponse(
		"Provider: v1.0.0",
		["🙂".repeat(600), "x".repeat(3000), "y".repeat(3000)],
		4096,
		"Continue: xcsh://terraform-documentation/?facet=provider_name&cursor=fixture",
	);
	expect(Buffer.byteLength(content)).toBeLessThanOrEqual(4096);
	expect(content).toContain("🙂".repeat(600));
	expect(content).not.toContain("xxx");
	expect(content).toContain("Continue:");
});

test("selection distinguishes provider role and competing choices from ranking values", () => {
	const leaf = { path: metadata().path, anchor: "schema-tls--certificate", metadata: metadata(), ranking: 20 };
	expect(selectTerraformCandidate([leaf], false)).toBe("leaf");
	expect(selectTerraformCandidate([leaf, { ...leaf, ranking: 19 }], false)).toBe("leaf");
	expect(selectTerraformCandidate([leaf, { ...leaf, anchor: "schema-tls--other", ranking: 19 }], false)).toBe(
		"choices",
	);
	expect(
		selectTerraformCandidate(
			[leaf, { ...leaf, ranking: 1, metadata: { ...metadata(), provider_type: "data-sources" } }],
			false,
		),
	).toBe("choices");
	expect(selectTerraformCandidate([leaf], true)).toBe("choices");
});

test("query identity keeps exact provider mentions anywhere and concrete HCL resource intent", () => {
	expect(
		terraformQueryIdentity("Draft HCL for backend servers and attach xcsh_origin_pool at the end").providerPhrase,
	).toBe("origin pool");
	expect(terraformQueryIdentity("Where do I configure routing on xcsh_http_loadbalancer?").providerPhrase).toBe(
		"http loadbalancer",
	);
	expect(
		terraformQueryIdentity("Draft the Terraform status block under Bot Defense in xcsh_cdn_loadbalancer")
			.providerType,
	).toBe("resources");
	expect(terraformQueryIdentity("Read xcsh_origin_pool data source properties").providerType).toBe("data-sources");
	expect(terraformQueryIdentity("Should this be a resource or a data source?")).not.toHaveProperty("providerType");
	expect(terraformQueryIdentity("HTTP body payload name")).not.toHaveProperty("providerPhrase");
});

test("provider mention normalizes ordinary multiword names and keeps longest contextual identity", () => {
	const names = ["http_loadbalancer", "certificate", "origin_pool", "bot_endpoint_policy", "authentication"];
	expect(terraformProviderMention("Set TLS certificates on my HTTP load balancer", names)).toBe("http_loadbalancer");
	expect(terraformProviderMention("Use the Bot Endpoint Policy data source", names)).toBe("bot_endpoint_policy");
	expect(terraformProviderMention("Backend servers under xcsh_origin_pool", names)).toBe("origin_pool");
	expect(terraformProviderMention("No known provider resource mentioned", names)).toBeUndefined();
});

test("alias context preserves exact snake-case leaf identity and branch evidence", () => {
	const query = "bot endpoint policy transaction success cookie_or";
	const exact = scoreTerraformAliasContext(
		query,
		"endpoint_policy_content.transaction_result_success.cookie_v2.cookies_none.cookie_operator.cookie.cookie_or",
		["bot", "endpoint", "policy"],
	);
	const parent = scoreTerraformAliasContext(query, "endpoint_policy_content.transaction_result_success", [
		"bot",
		"endpoint",
		"policy",
	]);
	expect(exact).toBeGreaterThan(parent);
	const failure = scoreTerraformAliasContext(
		query,
		"endpoint_policy_content.transaction_result_failure.cookie_v2.cookies_none.cookie_operator.cookie.cookie_or",
		["bot", "endpoint", "policy"],
	);
	expect(exact).toBeGreaterThan(failure);
	expect(
		scoreTerraformAliasContext("stateful auto_host_rewrite", "stateful_service.routes.auto_host_rewrite", []),
	).toBeGreaterThan(scoreTerraformAliasContext("stateful auto_host_rewrite", "service.routes.auto_host_rewrite", []));
});

test("task destination distinguishes usage pages from schema fields", () => {
	expect(terraformTaskDestination("Where is the minimal configuration example for xcsh_app_firewall?")).toEqual({
		role: "fundamentals",
		anchor: "minimal-configuration",
	});
	expect(terraformTaskDestination("Look up the root configuration of a data source")).toEqual({
		role: "fundamentals",
		anchor: "root-configuration",
	});
	expect(terraformTaskDestination("How do I import an existing origin pool into state?")).toEqual({ role: "import" });
	expect(terraformTaskDestination("Show lifecycle timeout usage examples")).toEqual({ role: "timeouts" });
	expect(terraformTaskDestination("Which create and delete timeout attributes are in the schema?")).toBeUndefined();
	expect(terraformTaskDestination("Set HTTP connection idle timeout")).toBeUndefined();
	expect(terraformTaskDestination("Set TLS certificate name")).toBeUndefined();
	expect(terraformTaskDestination("Which resource manages WAF exclusion policies?")).toEqual({
		role: "fundamentals",
		anchor: "minimal-configuration",
	});
	expect(terraformTaskDestination("Where is the resource documented for creating a rate limiter?")).toEqual({
		role: "fundamentals",
		anchor: "minimal-configuration",
	});
	expect(terraformTaskDestination("Which data source reads configured servers of an existing origin pool?")).toEqual({
		role: "fundamentals",
		anchor: "root-configuration",
	});
	expect(terraformTaskDestination("Which resource field defines timeout duration?")).toBeUndefined();

	expect(terraformTaskDestination("Which action removes a cryptokey?")).toEqual({
		role: "fundamentals",
		anchor: "minimal-configuration",
	});
	expect(terraformTaskDestination("Declare an action to terminate a session")).toEqual({
		role: "fundamentals",
		anchor: "minimal-configuration",
	});
	expect(terraformTaskDestination("Which id field does the termination action require?")).toBeUndefined();
});

test("query role follows concrete provisioning versus lookup intent without treating existence as a data source", () => {
	expect(terraformQueryIdentity("Provision a Virtual Network object in Terraform").providerType).toBe("resources");
	expect(terraformQueryIdentity("Configure TLS on my HTTP load balancer").providerType).toBe("resources");
	expect(terraformQueryIdentity("Set private IP backend servers in an origin pool").providerType).toBe("resources");
	expect(terraformQueryIdentity("Inspect the status of an existing origin pool").providerType).toBe("data-sources");
	expect(terraformQueryIdentity("Look up existing certificate metadata").providerType).toBe("data-sources");
	expect(terraformQueryIdentity("Configure my existing origin pool").providerType).toBe("resources");
	expect(terraformQueryIdentity("Tell me about an origin pool")).not.toHaveProperty("providerType");
});

test("broad prose can narrow to known terms while unsupported exact fields stay fail-closed", () => {
	const exists = (term: string) => ["port", "https", "fixture", "cookie_or"].some(word => term.includes(`"${word}"`));
	expect(terraformKnownQueryTerms('"fixture"* AND "pleaseword"* AND "port"*', exists)).toEqual([
		'"fixture"*',
		'"port"*',
	]);
	expect(terraformKnownQueryTerms('"unsupported_field"*', exists)).toEqual([]);
});

test("operation identity resolves descriptive action names and keeps execution scope", () => {
	const names = [
		"dns_zone_add_cryptokey",
		"dns_zone_edit_cryptokey",
		"dns_zone_delete_cryptokey",
		"access_active_session_terminate",
		"access_active_sessions_terminate",
		"site_upgrade_os",
		"site_upgrade_sw",
	];
	expect(rankTerraformProviderNames("Invoke an action to remove a cryptokey from a DNS zone", names)[0]?.name).toBe(
		"dns_zone_delete_cryptokey",
	);
	expect(
		rankTerraformProviderNames("Declare an action to terminate a single active access session", names)[0]?.name,
	).toBe("access_active_session_terminate");
	expect(rankTerraformProviderNames("Terminate multiple active user access sessions", names)[0]?.name).toBe(
		"access_active_sessions_terminate",
	);
	expect(rankTerraformProviderNames("Upgrade a site's operating system", names)[0]?.name).toBe("site_upgrade_os");
	const ambiguous = rankTerraformProviderNames("Maintain cryptokeys in a DNS zone", names);
	expect(ambiguous.filter(row => row.score === ambiguous[0]?.score)).toHaveLength(3);
});

test("operation timeouts are distinct from transport timeouts and general usage", () => {
	expect(terraformTimeoutOperations("increase initial creation timeout")).toEqual(["create"]);
	expect(terraformTimeoutOperations("schema create and delete timeout duration strings")).toEqual([
		"create",
		"delete",
	]);
	expect(terraformTimeoutOperations("adjust refresh operation timeout")).toEqual(["read"]);
	expect(terraformTimeoutOperations("increase HTTP connection idle timeout")).toEqual([]);
	expect(terraformTimeoutOperations("show lifecycle timeout usage guidance")).toEqual([]);
	expect(terraformTimeoutOperations("configure backend request timeout")).toEqual([]);
	expect(terraformTimeoutOperations("Configure timeout duration in seconds for resource probe")).toEqual([]);
});

test("repeated schema branches require deciding context even with unequal scores", () => {
	const branch = (path: string, ranking: number) => ({
		path: `documentation/resources/fixture/${path}/index.md`,
		anchor: "section",
		metadata: { ...metadata(), schema_path: path.split(".") },
		ranking,
	});
	const choices = [
		branch("single_lb_app.enable_discovery.password", 100),
		branch("enable_api_discovery.password", 20),
	];
	expect(selectTerraformCandidate(choices, false, "configure discovery password")).toBe("choices");
	expect(selectTerraformCandidate(choices, false, "single_lb_app enable_discovery password")).toBe("leaf");
	expect(selectTerraformCandidate(choices, false, "enable_api_discovery password")).toBe("choices");
	const cookies = [
		branch("cookies_none.cookie_operator.cookie_or", 100),
		branch("cookies_and.cookie_operator.cookie_or", 20),
	];
	expect(selectTerraformCandidate(cookies, false, "cookie operator cookie_or")).toBe("choices");
	expect(selectTerraformCandidate(cookies, false, "cookies_none cookie operator cookie_or")).toBe("leaf");
	expect(selectTerraformCandidate([branch("tls.name", 100), branch("routing.port", 20)], false, "tls name")).toBe(
		"leaf",
	);
});

test("provider identity follows the named owner instead of nested schema nouns", () => {
	expect(
		terraformProviderMention("login failure on protected application endpoints in a CDN load balancer", [
			"protected_application",
			"cdn_loadbalancer",
		]),
	).toBe("cdn_loadbalancer");
	expect(
		terraformProviderMention("response headers on HTTP load balancer ports in a stateful workload", [
			"http_loadbalancer",
			"workload",
		]),
	).toBe("workload");
	expect(
		terraformProviderMention("compare the workload and HTTP load balancer", ["workload", "http_loadbalancer"]),
	).toBeUndefined();
	expect(terraformProviderMention("xcsh_workload HTTP load balancer fields", ["workload", "http_loadbalancer"])).toBe(
		"workload",
	);
});

test("provider credentials route to maintained setup options without confusing authentication resources", () => {
	expect(terraformProviderSetupDestination("configure API token authentication in the xcsh provider block")).toBe(
		"option-1-api-token-authentication",
	);
	expect(terraformProviderSetupDestination("credential setup for the provider with a P12 certificate")).toBe(
		"option-2-p12-certificate-authentication",
	);
	expect(terraformProviderSetupDestination("provider authentication using PEM certificate and private key")).toBe(
		"option-3-pem-certificate-authentication",
	);
	expect(terraformProviderSetupDestination("set up authentication so the xcsh provider can manage resources")).toBe(
		"authentication-options",
	);
	expect(terraformProviderSetupDestination("configure xcsh_authentication resource JWT validation")).toBeUndefined();
	expect(terraformProviderSetupDestination("TLS certificates on HTTP load balancer resource")).toBeUndefined();
});

test("task and role identity accepts ordinary grammatical variants", () => {
	expect(terraformTaskDestination("What command imports an existing xcsh_dns_zone resource?")).toEqual({
		role: "import",
	});
	expect(terraformTaskDestination("Where is the action documented to modify an existing cryptokey?")).toEqual({
		role: "fundamentals",
		anchor: "minimal-configuration",
	});
	expect(terraformQueryIdentity("minimal example for creating a new xcsh_app_firewall policy").providerType).toBe(
		"resources",
	);
	expect(terraformQueryIdentity("root configuration for deploying a TCP load balancer").providerType).toBe(
		"resources",
	);
	expect(terraformProviderSetupDestination("PKCS#12 bundle authentication in the provider")).toBe(
		"option-2-p12-certificate-authentication",
	);
	expect(terraformProviderSetupDestination("environment variables for API credentials in the provider")).toBe(
		"argument-reference",
	);
	expect(terraformTaskDestination("Which attributes are exported by this action?")).toBeUndefined();
});

test("direct property refinement uses field descriptions and keeps absent field intent undecided", () => {
	const sections = [
		{
			schema_path: ["origin_servers", "public_ip", "ip"],
			document_id: "public",
			anchor: "schema-ip",
			description: "Public IPv4 address.",
			aliases: [],
			relationships: [],
			flags: [],
		},
		{
			schema_path: ["origin_servers", "public_ip", "site_locator"],
			document_id: "public",
			anchor: "schema-site",
			description: "Site to discover server.",
			aliases: [],
			relationships: [],
			flags: [],
		},
	];
	expect(
		rankTerraformDirectProperties("specify the public IP address", ["origin_servers", "public_ip"], sections)[0]
			?.anchor,
	).toBe("schema-ip");
	expect(
		rankTerraformDirectProperties(
			"configure the public IP origin server block",
			["origin_servers", "public_ip"],
			sections,
		),
	).toEqual([]);
	const tls = [
		{
			...sections[0]!,
			schema_path: ["https", "http_redirect"],
			anchor: "schema-redirect",
			description: "Redirect HTTP traffic to HTTPS.",
		},
		{
			...sections[1]!,
			schema_path: ["https", "port"],
			anchor: "schema-port",
			description: "Listening port for HTTPS.",
		},
	];
	expect(rankTerraformDirectProperties("automatic redirection HTTP to HTTPS", ["https"], tls)[0]?.anchor).toBe(
		"schema-redirect",
	);
	expect(rankTerraformDirectProperties("HTTPS listener port", ["https"], tls)[0]?.anchor).toBe("schema-port");
});

test("declaration and lookup workflows target complete usage while field requests retain schema routing", () => {
	expect(terraformTaskDestination("How do I declare an xcsh_malicious_user_mitigation policy?")).toEqual({
		role: "fundamentals",
		anchor: "minimal-configuration",
	});
	expect(
		terraformTaskDestination("Where is xcsh_cloud_credentials resource defined for provider connectivity?"),
	).toEqual({ role: "fundamentals", anchor: "minimal-configuration" });
	expect(
		terraformTaskDestination("How do I obtain a short-lived registry token using an ephemeral resource?"),
	).toEqual({ role: "fundamentals", anchor: "minimal-configuration" });
	expect(terraformTaskDestination("How do I query an existing certificate using its data source?")).toEqual({
		role: "fundamentals",
		anchor: "root-configuration",
	});
	expect(
		terraformTaskDestination("Which output attribute exposes the token on an ephemeral resource?"),
	).toBeUndefined();
	expect(
		terraformTaskDestination("Where do I declare match rules inside the service policy resource?"),
	).toBeUndefined();
});

test("reviewed exclusive aliases choose a branch while shared TLS aliases do not", () => {
	const choices = [
		{ schema_path: ["https"], aliases: ["TLS certificates", "existing certificates"] },
		{ schema_path: ["https_auto_cert"], aliases: ["TLS certificates", "automatic certificate management"] },
	];
	expect(terraformNamedChoice("automatic certificate management for domains", choices)).toBe(1);
	expect(terraformNamedChoice("TLS certificates for domains", choices)).toBeUndefined();
	expect(terraformNamedChoice("existing certificates for domains", choices)).toBe(0);
	expect(
		terraformNamedChoice("compare existing certificates and automatic certificate management", choices),
	).toBeUndefined();
	expect(terraformNamedChoice("https_auto_cert", choices)).toBe(1);
	expect(terraformNamedChoice("https and https_auto_cert", choices)).toBeUndefined();
});

test("workflow grammar infers declaration role and lookup usage without literal resource names", () => {
	expect(terraformQueryIdentity("declare xcsh_malicious_user_mitigation policy").providerType).toBe("resources");
	expect(terraformQueryIdentity("provisioning an isolated network").providerType).toBe("resources");
	expect(terraformTaskDestination("data source documented for querying an existing service policy")).toEqual({
		role: "fundamentals",
		anchor: "root-configuration",
	});
	expect(terraformTaskDestination("Which resource manages WAF exclusion policies?")).toEqual({
		role: "fundamentals",
		anchor: "minimal-configuration",
	});
	expect(terraformTaskDestination("resource documented for creating a rate limiter")).toEqual({
		role: "fundamentals",
		anchor: "minimal-configuration",
	});
	expect(terraformTaskDestination("querying the status attribute of a data source")).toBeUndefined();
	expect(
		terraformTaskDestination("Querying the site data source, where is the IPv4 nexthop address?"),
	).toBeUndefined();
	expect(
		terraformTaskDestination("Looking up the policy data source, which schema section handles cookies?"),
	).toBeUndefined();
});

test("indexed provider filters remove redundant identity words from passage queries", () => {
	expect(
		terraformScopedSearchQuery("HTTPS listener port on xcsh_http_loadbalancer resource", "http_loadbalancer"),
	).toBe('"https"* AND "listener"* AND "port"*');
	expect(terraformScopedSearchQuery("HTTP load balancer Bot Defense login status", "http_loadbalancer")).toBe(
		'"bot"* AND "defense"* AND "login"* AND "status"*',
	);
	expect(terraformScopedSearchQuery("public IP origin servers in origin pool", "origin_pool")).toContain('"origin"*');
	expect(terraformScopedSearchQuery("xcsh_origin_pool", "origin_pool")).toBe("");
	expect(terraformScopedSearchQuery("HTTP load balancer TLS", undefined)).toContain('"http_loadbalancer"*');
});

test("provider ownership phrases outrank incidental nested provider names", () => {
	const names = ["cdn_loadbalancer", "secret_management_access", "workload", "http_loadbalancer"];
	expect(
		terraformProviderMention(
			"When creating a CDN load balancer resource, set the secret management access decryption provider",
			names,
		),
	).toBe("cdn_loadbalancer");
	expect(
		terraformProviderMention(
			"Which block inside a distributed workload resource defines HTTP load balancer routes?",
			names,
		),
	).toBe("workload");
	expect(
		terraformProviderMention("Compare a workload resource versus an HTTP load balancer resource", names),
	).toBeUndefined();
});

test("cloud resource credentials retain their provider scope instead of setup guidance", () => {
	expect(
		terraformProviderSetupDestination(
			"Which block in a cloud credentials resource configures AWS secret key credentials for cloud provider access?",
		),
	).toBeUndefined();
	expect(terraformProviderSetupDestination("Configure API token authentication for the xcsh provider")).toBe(
		"option-1-api-token-authentication",
	);
});

test("direct field descriptions recognize ordinary address wording", () => {
	const section = {
		schema_path: ["dual_stack", "ipv6", "addr"],
		document_id: "ipv6",
		anchor: "schema-addr",
		description: "IPv6 Address in form of string.",
		aliases: [],
		relationships: [],
		flags: [],
	};
	expect(
		rankTerraformDirectProperties(
			"which attribute sets the IPv6 next-hop address string",
			["dual_stack", "ipv6"],
			[section],
		)[0]?.anchor,
	).toBe("schema-addr");
	expect(rankTerraformDirectProperties("configure IPv6 block", ["dual_stack", "ipv6"], [section])).toEqual([]);
});

test("provider names normalize documented product abbreviations", () => {
	const names = [
		"aws_tgw_site",
		"k8s_cluster",
		"bigip_http_proxy",
		"proxy",
		"cluster",
		"route",
		"securemesh_site",
		"network_interface",
	];
	expect(terraformProviderMention("AWS Transit Gateway site resource next-hop route", names)).toBe("aws_tgw_site");
	expect(terraformProviderMention("Kubernetes cluster resource administrative access", names)).toBe("k8s_cluster");
	expect(terraformProviderMention("BIG-IP HTTP proxy resource settings", names)).toBe("bigip_http_proxy");
	expect(terraformProviderMention("secure mesh site resource network interface reference", names)).toBe(
		"securemesh_site",
	);
});

test("singular property requests retain exact data-source field routing", () => {
	expect(
		terraformTaskDestination(
			"In a site registrations data source query, which property exposes the chassis serial number?",
		),
	).toBeUndefined();
	expect(terraformTaskDestination("Where is this resource property documented?")).toBeUndefined();
	expect(terraformTaskDestination("How do I query the site registrations data source?")).toEqual({
		role: "fundamentals",
		anchor: "root-configuration",
	});
});

test("autonomous system number wording identifies the asn field over routing prose", () => {
	const field = {
		schema_path: ["peers", "external", "asn"],
		document_id: "peer",
		anchor: "schema-asn",
		description: "Autonomous System Number for BGP peer.",
		aliases: [],
		relationships: [],
		flags: [],
	};
	const other = {
		...field,
		schema_path: ["peers", "external", "routing"],
		anchor: "schema-routing",
		description: "Configure BGP routing resource for external peer.",
	};
	expect(
		rankTerraformDirectProperties(
			"In a managed BGP routing resource which property configures the autonomous system number for an external BGP peer",
			["peers", "external"],
			[field, other],
		)[0]?.anchor,
	).toBe("schema-asn");
});

test("a third candidate with an omitted provider role cannot be hidden by rank separation", () => {
	const m = metadata();
	const first = { path: m.path, anchor: "schema-tls--port", metadata: m, ranking: 100 };
	const second = { ...first, anchor: "schema-tls--timeout", ranking: 1 };
	const otherRole = {
		...first,
		path: "documentation/data-sources/fixture/index.md",
		metadata: { ...m, provider_type: "data-sources" },
		ranking: 0.5,
	};
	expect(selectTerraformCandidate([first, second, otherRole], false, "TLS port")).toBe("choices");
});

test("typed relationship enforcement cannot promote advisory dependencies to validation", () => {
	const base = { target_id: "target", anchor: "section", source: "verified-source" };
	for (const [type, enforcement] of [
		["requires", "upstream-advisory"],
		["advisory", "provider-schema"],
		["requires", "provider-choice"],
	]) {
		expect(() =>
			validateTerraformRetrievalMetadata({
				...metadata(),
				relationships: [{ ...base, type, enforcement }],
			} as TerraformMetadata),
		).toThrow();
	}
	expect(() =>
		validateTerraformRetrievalMetadata({
			...metadata(),
			relationships: [{ ...base, type: "advisory", enforcement: "upstream-advisory" }],
		} as TerraformMetadata),
	).not.toThrow();
	expect(() =>
		validateTerraformRetrievalMetadata({
			...metadata(),
			relationships: [{ ...base, type: "choice", enforcement: "provider-choice" }],
		} as TerraformMetadata),
	).not.toThrow();
});

test("singular route prose identifies the exclusive outside branch", () => {
	const m = metadata();
	const first = {
		path: "outside.md",
		anchor: "section",
		metadata: { ...m, schema_path: ["vn_config", "outside_static_routes", "custom_static_route", "dual_stack"] },
		ranking: 100,
	};
	const inside = {
		...first,
		path: "inside.md",
		metadata: { ...m, schema_path: ["vn_config", "inside_static_routes", "custom_static_route", "dual_stack"] },
		ranking: 1,
	};
	expect(
		selectTerraformCandidate([first, inside], false, "dual-stack next-hop IP addresses for an outside static route"),
	).toBe("leaf");
	expect(selectTerraformCandidate([first, inside], false, "dual-stack next-hop IP addresses for a static route")).toBe(
		"choices",
	);
});

test("section field flags nesting and cardinality reject malformed schema hints", () => {
	const section = {
		schema_path: ["tls", "port"],
		document_id: "fixture",
		anchor: "schema-tls--port",
		description: "Port.",
		aliases: [],
		relationships: [],
		flags: ["optional"],
	};
	for (const change of [
		{ flags: ["invented"] },
		{ flags: [3] },
		{ nesting: "unknown" },
		{ min_items: -1 },
		{ max_items: 1.5 },
		{ min_items: 3, max_items: 2 },
	]) {
		expect(() =>
			validateTerraformRetrievalMetadata({
				...metadata(),
				sections: [{ ...section, ...change }],
			} as TerraformMetadata),
		).toThrow();
	}
	expect(() =>
		validateTerraformRetrievalMetadata({
			...metadata(),
			sections: [{ ...section, nesting: "list", min_items: 1, max_items: 2 }],
		} as TerraformMetadata),
	).not.toThrow();
});

test("application firewall resource terminology resolves the provider owner", () => {
	expect(
		terraformProviderMention(
			"Which configuration block in a managed application firewall resource enables blocking?",
			["app_firewall", "dns_zone"],
		),
	).toBe("app_firewall");
	expect(terraformProviderMention("Inspect an application firewall data source", ["app_firewall", "dns_zone"])).toBe(
		"app_firewall",
	);
});

test("health check monitor terminology identifies its provider owner", () => {
	expect(
		terraformProviderMention("Where is the response timeout property documented for a health check monitor?", [
			"healthcheck",
			"workload",
		]),
	).toBe("healthcheck");
});

test("alternative read and declaration workflows do not force a provider role", () => {
	for (const query of [
		"Retrieve or declare domains for a load balancer",
		"Inspect or configure a rate limiter",
		"Read or define a BGP peer",
		"Configure or check application firewall blocking",
	]) {
		expect(terraformQueryIdentity(query).providerType).toBeUndefined();
	}
	expect(terraformQueryIdentity("Configure a rate limiter resource").providerType).toBe("resources");
});
test("concrete value requests do not route to declaration examples", () => {
	expect(terraformTaskDestination("Declare the external route next-hop IPv6 address on xcsh_fixture")).toBeUndefined();
	expect(terraformTaskDestination("Declare xcsh_fixture resource")).toEqual({
		role: "fundamentals",
		anchor: "minimal-configuration",
	});
});

test("lookup and ephemeral computed values remain property questions", () => {
	expect(terraformTaskDestination("Query xcsh_fixture data source to read a cookie name.")).toBeUndefined();
	expect(
		terraformTaskDestination("Declare xcsh_fixture ephemeral resource to retrieve a computed token."),
	).toBeUndefined();
	expect(terraformTaskDestination("Query xcsh_fixture data source")).toEqual({
		role: "fundamentals",
		anchor: "root-configuration",
	});
});

test("named data source values are not usage examples", () => {
	for (const q of [
		"Query xcsh_fixture data source to inspect listen_port",
		"Read served domains from xcsh_fixture data source",
		"Query xcsh_fixture data source to retrieve configured receivers",
	]) {
		expect(terraformTaskDestination(q)).toBeUndefined();
	}
	expect(terraformTaskDestination("Query xcsh_fixture data source")).toEqual({
		role: "fundamentals",
		anchor: "root-configuration",
	});
});

test("collection requests preserve the complete property instead of selecting an item field", () => {
	const section = {
		schema_path: ["address_prefixes", "address_prefix"],
		document_id: "prefixes",
		anchor: "schema-prefix",
		description: "An address prefix in the collection.",
		aliases: [],
		relationships: [],
		flags: [],
	};
	expect(
		rankTerraformDirectProperties(
			"In xcsh_fixture, configure the list of address prefixes for policy matching",
			["address_prefixes"],
			[section],
		),
	).toEqual([]);
	expect(
		rankTerraformDirectProperties(
			"Which field specifies an address prefix item in xcsh_fixture?",
			["address_prefixes"],
			[section],
		)[0]?.anchor,
	).toBe("schema-prefix");
});

test("explicit action arguments and boolean flags remain property requests", () => {
	expect(
		terraformTaskDestination("In xcsh_fixture action, which argument specifies the software version?"),
	).toBeUndefined();
	expect(
		terraformTaskDestination(
			"Which required identifier argument specifies the key to delete in xcsh_fixture action?",
		),
	).toBeUndefined();
});

test("explicit provider role wins over incidental query and action nouns", () => {
	expect(
		terraformQueryIdentity("In a managed xcsh_workload stateful service, which block retains query parameters?")
			.providerType,
	).toBe("resources");
	expect(terraformQueryIdentity("Read data.xcsh_fixture computed fields including an action value").providerType).toBe(
		"data-sources",
	);
	expect(
		terraformQueryIdentity("In a managed xcsh_fixture resource, which property specifies the action on detection?")
			.providerType,
	).toBe("resources");
	expect(
		terraformQueryIdentity("Read data.xcsh_fixture or configure resource.xcsh_fixture").providerType,
	).toBeUndefined();
});

test("lifecycle operation wording excludes incidental verbs and conflicts", () => {
	for (const query of [
		"Read the documentation for the timeout field",
		"Read timeout documentation",
		"initial timeout field",
		"not creation timeout",
		"creation timeout rather than deletion timeout",
		"inspect timeout documentation",
	])
		expect(terraformTimeoutOperations(query)).toEqual([]);
	expect(terraformTimeoutOperations("maximum duration permitted for Namespace creation")).toEqual(["create"]);
	expect(terraformTimeoutOperations("timeout for read operation")).toEqual(["read"]);
	expect(terraformTimeoutOperations("timeout for resource modification")).toEqual(["update"]);
});

test("parsed named blocks bypass general declaration examples", () => {
	expect(
		terraformTaskDestination(
			"In xcsh_fixture, where do I declare a direct response route block to return status and body?",
		),
	).toBeUndefined();
	expect(terraformTaskDestination("Where do I declare xcsh_fixture resource block?")).toEqual({
		role: "fundamentals",
		anchor: "minimal-configuration",
	});
});

test("a named property block definition is not a resource declaration example", () => {
	expect(
		terraformTaskDestination("In xcsh_fixture resource, where is the definition of the routes list block?"),
	).toBeUndefined();
});

test("on-a provider ownership outranks an incidental longer nested entity", () => {
	const names = ["http_loadbalancer", "protected_application", "cdn_loadbalancer"];
	expect(
		terraformProviderMention(
			"On an HTTP load balancer, configure login response fields in protected application endpoints",
			names,
		),
	).toBe("http_loadbalancer");
	expect(
		terraformProviderMention(
			"Login response fields in protected application endpoints on a CDN load balancer",
			names,
		),
	).toBe("cdn_loadbalancer");
	expect(terraformProviderMention("Compare HTTP load balancer and protected application", names)).toBeUndefined();
});

test("documentation lookup does not imply the data-source role", () => {
	expect(terraformQueryIdentity("Look up the schema and examples for xcsh_fixture").providerType).toBeUndefined();
	expect(terraformQueryIdentity("Inspect documentation for xcsh_fixture").providerType).toBeUndefined();
	expect(terraformQueryIdentity("Look up an existing xcsh_fixture object").providerType).toBe("data-sources");
	expect(terraformQueryIdentity("Inspect data source xcsh_fixture schema").providerType).toBe("data-sources");
	expect(terraformQueryIdentity("Read xcsh_fixture resource documentation").providerType).toBe("resources");
});

test("querying a schema identifier bypasses data-source root configuration", () => {
	expect(terraformTaskDestination("Query auto_host_rewrite on a route in data source xcsh_fixture")).toBeUndefined();
	expect(terraformTaskDestination("Query existing object using data source xcsh_fixture")).toEqual({
		role: "fundamentals",
		anchor: "root-configuration",
	});
});

test("object query and nested value query have distinct routes", () => {
	expect(terraformTaskDestination("Query data source xcsh_fixture to read served domains")).toBeUndefined();
	expect(
		terraformTaskDestination("Query the existing object using data source xcsh_fixture to read served domains"),
	).toBeUndefined();
	expect(terraformTaskDestination("Query an existing certificate using data source xcsh_fixture")).toEqual({
		role: "fundamentals",
		anchor: "root-configuration",
	});
});

test("query property phrases bypass root configuration without changing role", () => {
	expect(
		terraformTaskDestination("Query the name of an existing gateway using data source xcsh_fixture"),
	).toBeUndefined();
	expect(
		terraformQueryIdentity("Query the name of an existing gateway using data source xcsh_fixture").providerType,
	).toBe("data-sources");
	expect(terraformTaskDestination("Query an existing certificate using data source xcsh_fixture")).toEqual({
		role: "fundamentals",
		anchor: "root-configuration",
	});
});

test("provider environment variable names are setup vocabulary rather than resource identities", () => {
	expect(
		terraformProviderSetupDestination(
			"How do I configure environment variables XCSH_API_URL and XCSH_API_TOKEN to authenticate the xcsh provider?",
		),
	).toBe("option-1-api-token-authentication");
	expect(
		terraformProviderSetupDestination("Configure xcsh_cloud_credentials provider authentication"),
	).toBeUndefined();
});

test("HTTP application-balancer phrasing identifies documented HTTP provider without replacing explicit identities", () => {
	expect(
		terraformProviderMention("Set up HTTP cookie persistence in our application balancer", [
			"http_loadbalancer",
			"cdn_loadbalancer",
		]),
	).toBe("http_loadbalancer");
	expect(
		terraformProviderMention("Set up HTTP cookie persistence in xcsh_cdn_loadbalancer application balancer", [
			"http_loadbalancer",
			"cdn_loadbalancer",
		]),
	).toBe("cdn_loadbalancer");
	expect(
		terraformProviderMention("application balancer cookie persistence", ["http_loadbalancer", "cdn_loadbalancer"]),
	).toBeUndefined();
});

test("negated HTTP qualification cannot identify an application balancer provider", () => {
	expect(
		terraformProviderMention("Configure application balancer for TCP, not HTTP", [
			"http_loadbalancer",
			"tcp_loadbalancer",
		]),
	).toBeUndefined();
});

test("literal provider names and HTTP purpose qualifiers remain authoritative", () => {
	const names = ["http_loadbalancer", "cdn_loadbalancer"];
	expect(
		terraformProviderMention("Configure HTTP cookie persistence in cdn_loadbalancer application balancer", names),
	).toBe("cdn_loadbalancer");
	expect(terraformProviderMention("Configure application balancer to provide HTTP support", names)).toBeUndefined();
	expect(terraformProviderMention("Configure application balancer without using HTTP", names)).toBeUndefined();
});

test("HTTP provider evidence excludes purpose-only HTTP but retains unrelated negation", () => {
	const names = ["http_loadbalancer", "cdn_loadbalancer"];
	expect(terraformProviderMention("Configure application balancer to enable HTTP support", names)).toBeUndefined();
	expect(terraformProviderMention("Configure application balancer without cookies using HTTP", names)).toBe(
		"http_loadbalancer",
	);
});

test("HTTP in a separate health-check clause is not provider identity", () => {
	expect(
		terraformProviderMention("Configure application balancer for TCP, and configure HTTP health checks", [
			"http_loadbalancer",
			"tcp_loadbalancer",
		]),
	).toBeUndefined();
});

test("HTTP health-check purpose does not identify application balancer type", () => {
	expect(
		terraformProviderMention("Configure application balancer for HTTP health checks", [
			"http_loadbalancer",
			"tcp_loadbalancer",
		]),
	).toBeUndefined();
});

test("qualified value lookups retain property routing without field nouns", () => {
	for (const query of [
		"For the sensor resource, where is the calibration adjustment documented?",
		"Locate the retry ceiling documented for the queue resource.",
		"Find the deletion timeout documented for the sensor resource.",
	])
		expect(terraformTaskDestination(query)).toBeUndefined();
	expect(terraformTaskDestination("Where is the resource documented for creating a sensor?")).toEqual({
		role: "fundamentals",
		anchor: "minimal-configuration",
	});
});

test("value lookup preserves explicit lifecycle guidance", () => {
	expect(terraformTaskDestination("Find lifecycle guidance on writing operation timeout durations.")).toEqual({
		role: "timeouts",
	});
});

test("value lookup clauses retain dotted paths and separate requested values from followups", () => {
	expect(
		propertyRequestedText("Terraform sensor resource: locate calibration.offset; I still need to supply its value."),
	).toBe("calibration.offset");
	expect(propertyRequestedText("Locate memory allocation and its unit.")).toBe("memory allocation");
	expect(propertyRequestedText("Find the deployment example.")).toBeUndefined();
	expect(propertyRequestedText("Find the resource documentation.")).toBeUndefined();
	expect(propertyRequestedText("Which field sets port under listener?")).toBe("port under listener?");
});

test("lookup clauses preserve order and isolate sentence-local requests", () => {
	expect(propertyRequestedText("Supply the retry ceiling; locate calibration.offset.")).toBe(
		"the retry ceiling; locate calibration.offset.",
	);
	for (const boundary of ["?", "!", ";", "."])
		expect(propertyRequestedText(`Locate calibration.offset${boundary} Supply retry ceiling.`)).toBe(
			"calibration.offset",
		);
	expect(propertyRequestedText("Locate the actual calibration offset.")).toBe("the actual calibration offset");
	expect(propertyRequestedText("Locate calibration.offset; show a usage example.")).toBe("calibration.offset");
	expect(propertyRequestedText("Locate memory allocation and   its unit.")).toBe("memory allocation");
});

test("ordinary setting and placement questions identify requested schema values", () => {
	expect(propertyRequestedText("Which setting controls the sensor calibration interval?")).toBe(
		"the sensor calibration interval?",
	);
	expect(propertyRequestedText("Where do I put the retry ceiling?")).toBe("the retry ceiling");
	expect(propertyRequestedText("Where do I put the resource declaration?")).toBeUndefined();
	expect(propertyRequestedText("Which setting controls how long the worker session lasts?")).toBe(
		"how long the worker session lasts?",
	);
});

test("placement questions retain the requested collection or field", () => {
	expect(propertyRequestedText("Where do DNS server addresses go for the router?")).toBe("DNS server addresses");
	expect(propertyRequestedText("Where does the retry ceiling belong?")).toBe("the retry ceiling");
});

test("secure mesh product version identifies its documented site provider", () => {
	const names = ["securemesh_site", "securemesh_site_v2", "network_interface"];
	expect(terraformProviderMention("Terraform secure mesh v2 resource router DNS servers", names)).toBe(
		"securemesh_site_v2",
	);
	expect(terraformProviderMention("Compare secure mesh v2 and network interface", names)).toBeUndefined();
	expect(terraformProviderMention("xcsh_network_interface with secure mesh v2", names)).toBe("network_interface");
});

test("provider names normalize load balancer spaces and underscores consistently", () => {
	expect(terraformProviderMention("Terraform DNS load balancer resource", ["dns_load_balancer", "dns_proxy"])).toBe(
		"dns_load_balancer",
	);
	expect(
		terraformProviderMention("Terraform HTTP load balancer resource", ["http_loadbalancer", "dns_load_balancer"]),
	).toBe("http_loadbalancer");
});

test("passive value documentation queries are not resource declaration examples", () => {
	expect(
		terraformTaskDestination("Where is the email for a Terraform container registry resource documented?"),
	).toBeUndefined();
	expect(terraformTaskDestination("Where is the resource documented for creating a registry?")).toEqual({
		role: "fundamentals",
		anchor: "minimal-configuration",
	});
});

test("passive placement and need statements extract values without provider-only intent", () => {
	expect(propertyRequestedText("Where is the allowed response-code list?")).toBe("the allowed response-code list");
	expect(propertyRequestedText("I need the upstream idle timeout.")).toBe("the upstream idle timeout");
	expect(propertyRequestedText("I need an origin pool resource.")).toBeUndefined();
	expect(propertyRequestedText("Where is the resource documented?")).toBe("the resource");
	expect(propertyRequestedText("Which field names the receiver?")).toBe("the receiver?");
});

test("a specific lookup follows a general need statement without replacing its target", () => {
	expect(propertyRequestedText("I need a storage location. Locate the certificate URL; I will supply it later.")).toBe(
		"the certificate URL",
	);
	expect(propertyRequestedText("Locate the retry value in a queue resource.")).toBe(
		"the retry value in a queue resource",
	);
});

test("allowlist product-role wording resolves the maintained network data source", () => {
	const names = ["network_regional_edges", "network_cdn", "network_dnslb_health_checks", "dns_load_balancer"];
	expect(terraformProviderMention("Regional Edge allowlist data source regions", names)).toBe(
		"network_regional_edges",
	);
	expect(terraformProviderMention("CDN allowlist data source CIDRs", names)).toBe("network_cdn");
	expect(terraformProviderMention("DNS load-balancer health-check ingress allowlist data source", names)).toBe(
		"network_dnslb_health_checks",
	);
	expect(terraformProviderMention("xcsh_dns_load_balancer reference to CDN allowlist", names)).toBe(
		"dns_load_balancer",
	);
	expect(terraformProviderMention("dns_load_balancer reference to CDN allowlist", names)).toBe("dns_load_balancer");
	expect(terraformProviderMention("Compare CDN allowlist with Regional Edge allowlist", names)).toBeUndefined();
});

test("allowlist references cannot capture a prose resource owner", () => {
	const names = ["http_loadbalancer", "network_cdn"];
	for (const q of [
		"Find the field on an HTTP load balancer resource that references the CDN allowlist",
		"HTTP load balancer resource without a CDN allowlist",
		"HTTP load balancer resource (for example CDN allowlist)",
	])
		expect(terraformProviderMention(q, names)).toBe("http_loadbalancer");
});

test("passing and writing values retain schema value intent", () => {
	expect(propertyRequestedText("How do I pass session tags into the worker?")).toBe("session tags into the worker?");
	expect(propertyRequestedText("Where do I write the custom response body?")).toBe("the custom response body?");
	expect(propertyRequestedText("How is the protocol enabled or disabled on the service?")).toBe("the protocol");
});

test("negated allowlist family mentions do not become product owners", () => {
	for (const q of ["Find the allowlist data source, not CDN", "Find the allowlist data source without CDN"])
		expect(terraformProviderMention(q, ["network_cdn"])).toBeUndefined();
});

test("field selection verbs describe scalar meaning rather than block selection", () => {
	expect(propertyRequestedText("Which field selects the query parameter whose value is masked?")).toBe(
		"the query parameter whose value is masked?",
	);
	expect(propertyRequestedText("Which field chooses the protocol version?")).toBe("the protocol version?");
});

test("provider ownership preserves stateful and stateless resource modifiers", () => {
	const names = ["http_loadbalancer", "workload"];
	for (const modifier of ["stateless-service", "stateless service", "stateful-service", "stateful service"]) {
		expect(
			terraformProviderMention(
				"Find HTTP load balancer TLS on a Terraform workload " + modifier + " resource",
				names,
			),
		).toBe("workload");
		expect(
			terraformProviderMention("For a workload " + modifier + " resource, locate HTTP load balancer TLS", names),
		).toBe("workload");
	}
	expect(
		terraformProviderMention("Compare workload stateless service resource and HTTP load balancer resource", names),
	).toBeUndefined();
	expect(
		terraformProviderMention("xcsh_http_loadbalancer referencing a workload stateless service resource", names),
	).toBe("http_loadbalancer");
});

test("resource modifier examples and rejected owners cannot capture identity", () => {
	for (const q of [
		"Locate HTTP load balancer TLS, not a workload stateless service resource",
		"Locate HTTP load balancer TLS (for example a workload stateless service resource)",
		"Locate HTTP load balancer TLS. A workload stateless service resource is unrelated.",
	])
		expect(terraformProviderMention(q, ["http_loadbalancer", "workload"])).toBe("http_loadbalancer");
});

test("unparenthesized examples and rejected modifier owners preserve identity", () => {
	for (const word of ["for example", "instead of", "rather than", "such as"])
		expect(
			terraformProviderMention("Locate HTTP load balancer TLS, " + word + " a workload stateless service resource", [
				"http_loadbalancer",
				"workload",
			]),
		).toBe("http_loadbalancer");
});

test("abbreviated provider examples cannot capture identity", () => {
	for (const modifier of ["stateless service", "stateful-service"])
		expect(
			terraformProviderMention("Locate HTTP load balancer TLS, e.g. a workload " + modifier + " resource", [
				"http_loadbalancer",
				"workload",
			]),
		).toBe("http_loadbalancer");
});
test("data source value lookup labels require a substantive property target", () => {
	expect(propertyRequestedText("Find data source output addresses")).toBe("addresses");
	expect(propertyRequestedText("Find the data-source input name")).toBe("name");
	expect(propertyRequestedText("Find data source output field addresses")).toBe("addresses");
	expect(propertyRequestedText("Find the data-source output preserving IPv4 entries")).toBe("preserving IPv4 entries");
	for (const q of [
		"Find data source output for CDN",
		"Find data source output of xcsh_network_cdn",
		"Find data source output using xcsh_network_cdn",
		"Find data source output",
		"Find data source",
	])
		expect(propertyRequestedText(q)).toBeUndefined();
	expect(propertyRequestedText("Find data source output addresses for CDN")).toBe("addresses");
});

test("data source labels preserve collections and literal fields", () => {
	expect(propertyRequestedText("Find data source output list of addresses")).toBe("list of addresses");
	expect(propertyRequestedText("Find data source field output")).toBe("output");
	expect(propertyRequestedText("Find data source field `output`")).toBe("`output`");
	for (const q of [
		"Find data source output input",
		"Find data source output the input from CDN",
		"Find data source output field",
	])
		expect(propertyRequestedText(q)).toBeUndefined();
});

test("data source label requests retain negation and reject location-only targets", () => {
	for (const q of [
		"Do not find data source field name",
		"Never locate data source output addresses",
		"Find data source output in CDN",
		"Find data source output within xcsh_network_cdn",
		"Find data source output under xcsh_network_cdn",
	])
		expect(propertyRequestedText(q)).toBeUndefined();
	expect(propertyRequestedText("Find data source output addresses in CDN")).toBe("addresses in CDN");
});

test("lookup negation is verb-local and literal location field names remain valid", () => {
	expect(propertyRequestedText("Without changing the resource, find data source output addresses")).toBe("addresses");
	expect(propertyRequestedText("Do not use CDN, but find data source output addresses")).toBe("addresses");
	for (const field of ["inside", "in", "within", "under"])
		expect(propertyRequestedText("Find data source attribute " + field)).toBe(field);
	expect(propertyRequestedText("Do not find data source output addresses. Find data source output domains")).toBe(
		"domains",
	);
});
test("terminal ownership qualifiers preserve request and nesting structure", () => {
	expect(propertyRequestedText("Find raw IPv4 entries on the network data source")).toBe("raw IPv4 entries");
	for (const q of [
		"find timeout on the compute resource and locate name on the other resource",
		"find timeout on the resource under retry on the compute resource",
		"do not find timeout on the compute resource",
		"find timeout on the compute resource and its name or id",
	])
		expect(propertyRequestedText(q)).toContain("on the");
	expect(propertyRequestedText("Which field holds on demand resource allocation policy?")).toBe(
		"on demand resource allocation policy?",
	);
	expect(propertyRequestedText("Find input within transform")).toBe("input within transform");
	expect(propertyRequestedText('Find "on the resource" label')).toBe('"on the resource" label');
});

test("a value-setting noun does not infer managed-resource intent", () => {
	expect(
		terraformQueryIdentity("For xcsh_advertise_policy. Which setting lists allowed TLS ciphers?").providerType,
	).toBeUndefined();
	expect(
		terraformQueryIdentity("For xcsh_advertise_policy. How is the ordered hash-algorithm list represented?")
			.providerType,
	).toBeUndefined();
	expect(terraformQueryIdentity("I am setting up xcsh_advertise_policy").providerType).toBe("resources");
	expect(terraformQueryIdentity("I am setting the allowed TLS ciphers on xcsh_advertise_policy").providerType).toBe(
		"resources",
	);
});

test("general operation timeout format requests use lifecycle guidance", () => {
	for (const q of [
		"How do I configure operation wait limits for xcsh_fixture in HCL?",
		"Which duration format is accepted by xcsh_fixture timeouts in HCL?",
		"Can HCL customize operation timeouts for xcsh_fixture, and how are they written?",
	])
		expect(terraformTaskDestination(q)).toEqual({ role: "timeouts" });
	expect(terraformTaskDestination("Which create timeout field controls xcsh_fixture creation?")).not.toEqual({
		role: "timeouts",
	});
});
