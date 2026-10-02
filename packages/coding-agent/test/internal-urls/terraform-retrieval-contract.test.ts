import { expect, test } from "bun:test";
import {
	boundedTerraformResponse,
	rankTerraformDirectProperties,
	rankTerraformProviderNames,
	scoreTerraformAliasContext,
	selectTerraformCandidate,
	type TerraformMetadata,
	terraformKnownQueryTerms,
	terraformProviderMention,
	terraformProviderSetupDestination,
	terraformQueryIdentity,
	terraformTaskDestination,
	terraformTimeoutOperations,
	validateTerraformRetrievalMetadata,
} from "../../src/internal-urls/terraform-documentation";

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
