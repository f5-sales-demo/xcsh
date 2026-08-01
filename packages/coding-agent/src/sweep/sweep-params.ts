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
 *  - FORM_SWEEP_BLOCKERS: generated console workflows that are known not to
 *    model a required nested form. They are reported separately until the
 *    source workflows are fixed and validated upstream.
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
 * Known blockers in generated create workflows. These workflows are owned by
 * the console catalog; the embedded copy in this repository must not be patched
 * by hand. Keep each reason explicit so a sweep cannot silently treat a known
 * invalid workflow as supported coverage.
 */
export const FORM_SWEEP_BLOCKERS: Readonly<Record<string, string>> = {
	"alert-policy": "placeholder defaults for nested alert_receivers and policy_rules fields",
	"malicious-user-mitigation": "missing nested Add Item steps for the required rules field",
	"data-type": "placeholder default for the nested data_type_rules field",
	policer: "missing nested Add Item steps for the required policer_rules field",
	"user-identification": "missing nested Add Item steps for the required rules field",
	"usb-policy": "placeholder default for the nested allowed_usb_devices field",
	"dns-lb-pool": "missing nested Add Item steps for the required pool_members field",
	"app-setting": "placeholder default for the nested app_type_settings field",
	bgp: "missing nested form steps for the required bgp_parameters field",
	subnet: "placeholder default for the nested site_subnet_parameters field",
	"third-party-application": "missing nested form steps for the required application_configuration field",
};

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
	// origin-pool: values come from the spec (resource_examples.yaml minimal →
	// workflow param defaults), NOT hand-coded here. See generate-workflows.ts.
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
	// fleet upgrade_wait_time (spec constraint lte:900) belongs in the workflow
	// param default, derived from the spec — not hand-coded here.
	"virtual-site": { site_selector_expression: "ves.io/siteName in (xcsh-sweep)" },
};

/** True when a resource is scoped out of the sweep (cloud/external dependency). */
export function isScopedOut(resource: string): boolean {
	return SCOPED_OUT.has(resource);
}

/** Return the upstream workflow blocker for a form sweep, when one is known. */
export function formSweepBlockerFor(resource: string): string | undefined {
	return FORM_SWEEP_BLOCKERS[resource];
}

/** Merge curated sweep inputs over the base {name, namespace} for a resource. */
export function paramsFor(resource: string, base: Record<string, unknown>): Record<string, unknown> {
	return { ...base, ...(SWEEP_PARAMS[resource] ?? {}) };
}
