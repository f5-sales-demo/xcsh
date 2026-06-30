/**
 * Sweep-only test inputs. Many console resources require fields beyond
 * name+namespace to create. Rather than baking test values (passwords, demo
 * domains) into the SHIPPED catalog as "defaults" — which would leak into real
 * users' forms — the sweep supplies them here, merged into the params passed to
 * the workflow runner.
 *
 * Two categories:
 *  - SWEEP_PARAMS: curated scalar values for resources creatable standalone once
 *    their required scalar fields are filled (Bucket A1).
 *  - SCOPED_OUT: resources that inherently need real cloud credentials or
 *    pre-provisioned external infrastructure (cloud sites, connectors). These
 *    are NOT sweepable on staging with name+namespace and are excluded from the
 *    coverage denominator rather than counted as failures.
 */

/** A throwaway password that satisfies typical complexity rules. */
const TEST_PW = "Xcsh-Sweep-Pw-2026!";

/**
 * Resources excluded from the sweep: they require real cloud credentials or
 * pre-provisioned external infra. Documented as "not sweepable on staging",
 * not failures.
 */
export const SCOPED_OUT: ReadonlySet<string> = new Set([
	"aws-tgw-site",
	"aws-vpc-site",
	"azure-vnet-site",
	"gcp-vpc-site",
	"cloud-connect",
	"cloud-credentials",
	"cloud-link",
	"cloud-elastic-ip",
	"securemesh-site",
	"securemesh-site-v2",
	"external-connector",
	"nfv-service",
	"discovery",
	"code-base-integration",
]);

/**
 * Curated scalar inputs for standalone-creatable resources (Bucket A1). Only
 * high-confidence scalar fields are filled here; structured/nested or
 * dependency-reference fields are handled separately (dependency provisioning).
 */
export const SWEEP_PARAMS: Readonly<Record<string, Record<string, unknown>>> = {
	// --- credentials (passwords) ---
	"api-credential": { password: TEST_PW, confirm_password: TEST_PW },
	"service-credential": { password: TEST_PW, confirm_password: TEST_PW },
	"container-registry": { password: TEST_PW },
	// --- simple scalars ---
	"http-load-balancer": { domains: ["xcsh-sweep.example.com"] },
	"tcp-load-balancer": { domains: ["xcsh-sweep.example.com"], listen_port_value: 80 },
	"dns-domain": { domain_name: "xcsh-sweep.example.com" },
	"ip-prefix-set": { prefix: ["10.10.0.0/24"] },
	crl: { crl_server_address: "http://xcsh-sweep.example.com/crl.pem" },
	"authorization-server": { jwks_uri: "https://www.googleapis.com/oauth2/v3/certs" },
	// --- enum/choice scalars (unblock the conditional workflow step) ---
	"network-policy-rule": { protocol: "TCP" },
	"dns-load-balancer": { record_type: "A", pool: "xcsh-sweep-dns-lb-pool" },
	"cdn-cache-rule": { rule_name: "xcsh-sweep-rule" },
	"voltstack-site": { volterra_certified_hw: "isv-8000-series-voltstack-combo" },
	tunnel: { local_ip: "10.10.0.1" },
	// --- dependency refs (name of a resource that may or may not exist on the tenant) ---
	"protocol-policer": { policer: "xcsh-sweep-policer" },
	"dns-load-balancer-pool": { pool: "xcsh-sweep-dns-lb-pool" },
	"app-api-group": { http_load_balancer: "xcsh-sweep-http-load-balancer" },
	endpoint: { reference: "xcsh-sweep-http-load-balancer" },
	"advertise-policy": { reference: "xcsh-sweep-http-load-balancer" },
	"shared-advertise-policy": { reference: "xcsh-sweep-http-load-balancer" },
	"origin-pool": { origin_servers: "Public DNS Name", port: 80 },
	// --- oneOf-choice defaults (select the choice to get past the param gate) ---
	"fast-acl": { site_choice: "re_acl", site_type_regional_edge: {} },
	"service-policy-rule": { waf_action: "None" },
	"nat-policy": { applies_to_choice: "site" },
	"network-connector": { connector_choice: "sli_to_slo_snat" },
	"site-mesh-group": { bfd_choice: "disable" },
	"network-interface": { ethernet_interface: "eth0" },
	"global-log-receiver": { log_type: "request_logs", receiver_configuration: "S3" },
	"log-receiver": { server_name: "xcsh-sweep.example.com", log_receiver_choice: "syslog" },
	"address-allocator": {
		address_allocator_mode: "VLAN",
		address_pool: "10.0.0.0/16",
		address_allocation_scheme: "DHCP",
	},
	"app-type": { ai_ml_feature_type: "Sensitive Data Detection" },
	proxy: { site_or_virtual_site: "site", proxy_choice: "http_proxy" },
	// --- nested/list required: NOT defaulted. These need real workflow steps
	// (Configure sub-forms, rule tables, Add Item flows). Fake "default"
	// placeholders were removed — they passed validateParams but put invalid
	// values into form fields (e.g. "default" in a Public IP field). These
	// resources fail honestly at validateParams until their workflow steps
	// handle the nested fields. ---
	// TODO: alert-policy, malicious-user-mitigation, data-type, policer,
	// user-identification, usb-policy, dns-lb-pool, app-setting, bgp, subnet,
	// third-party-application
	// Fleet: Upgrade Wait Time has x-ves-validation-rules lte:900; the console
	// pre-fills 30300 when Node by Node Upgrade is enabled. Spec-derived value.
	fleet: { upgrade_wait_time: 300 },
	"virtual-site": { site_selector_expression: "ves.io/siteName in (xcsh-sweep)" },
};

/** True when a resource is scoped out of the sweep (cloud/external dependency). */
export function isScopedOut(resource: string): boolean {
	return SCOPED_OUT.has(resource);
}

/** Merge curated sweep inputs over the base {name, namespace} for a resource. */
export function paramsFor(resource: string, base: Record<string, unknown>): Record<string, unknown> {
	return { ...base, ...(SWEEP_PARAMS[resource] ?? {}) };
}
