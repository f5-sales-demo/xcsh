// Auto-generated from api-specs-enriched/config/console_ui.yaml — DO NOT EDIT
// Regenerate: python3 from console_ui.yaml routes
import type { RouteEntry } from "./page-state-interpreter";

export const CONSOLE_ROUTES: readonly RouteEntry[] = [
	{
		resourceId: "address-allocator",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/networking/legacy_network_configuration/address_allocators",
	},
	{
		resourceId: "advertise-policy",
		workspace: "multi-cloud-app-connect",
		routePattern: "/namespaces/{namespace}/manage/virtual_host/advertise_policies",
	},
	{
		resourceId: "alert-policy",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/alert_config/alert_policies",
	},
	{
		resourceId: "alert-receiver",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/alert_config/alert_receivers",
	},
	{ resourceId: "api-credential", workspace: "administration", routePattern: "/personal-management/api_credentials" },
	{
		resourceId: "api-definition",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/api_security/api_definition",
	},
	{
		resourceId: "api-discovery",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/api_security/api_discovery",
	},
	{
		resourceId: "app-api-group",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/api_security/api_groups",
	},
	{
		resourceId: "app-firewall",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/app_firewall",
	},
	{
		resourceId: "app-setting",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/ai_ml/app_settings",
	},
	{ resourceId: "app-type", workspace: "shared-configuration", routePattern: "/security/ai_ml/app_types" },
	{
		resourceId: "authorization-server",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/shared_objects/authorization_server",
	},
	{
		resourceId: "aws-tgw-site",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/site_management/legacy_configs/aws_tgw_site",
	},
	{
		resourceId: "aws-vpc-site",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/site_management/legacy_configs/aws_vpc_site",
	},
	{
		resourceId: "azure-vnet-site",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/site_management/legacy_configs/azure_site",
	},
	{
		resourceId: "bgp",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/networking/external_connectivity/bgp",
	},
	{
		resourceId: "bgp-asn-set",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/shared_objects/bgp_asn_sets",
	},
	{
		resourceId: "bigip-virtual-server",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/bigip_virtual_server",
	},
	{
		resourceId: "cdn-cache-rule",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/cdn/cdn_cache_rule",
	},
	{
		resourceId: "cdn-loadbalancer",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/cdn/distributions",
	},
	{
		resourceId: "certificate",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/certificate_management/tls_certificate",
	},
	{
		resourceId: "cloud-connect",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/connectors/cloud_connect",
	},
	{
		resourceId: "cloud-credentials",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/site_management/other_configs/cloud_credential",
	},
	{
		resourceId: "cloud-elastic-ip",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/networking/network_configuration/cloud_elastic_ip",
	},
	{
		resourceId: "cloud-link",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/networking/external_connectivity/cloud_links",
	},
	{
		resourceId: "cluster",
		workspace: "multi-cloud-app-connect",
		routePattern: "/namespaces/{namespace}/manage/virtual_host/clusters",
	},
	{
		resourceId: "code-base-integration",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/api_security/code_base_integration",
	},
	{
		resourceId: "container-registry",
		workspace: "distributed-apps",
		routePattern: "/namespaces/{namespace}/applications/container_registries",
	},
	{
		resourceId: "crl",
		workspace: "multi-cloud-app-connect",
		routePattern: "/namespaces/{namespace}/manage/load_balancers/crl",
	},
	{
		resourceId: "data-type",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/api_security/data_type",
	},
	{
		resourceId: "dc-cluster-group",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/networking/site_to_site_connectivity/dc_cluster_groups",
	},
	{ resourceId: "discovery", workspace: "shared-configuration", routePattern: "/manage/discovery" },
	{ resourceId: "dns-domain", workspace: "dns-management", routePattern: "/manage/dns_domain" },
	{
		resourceId: "dns-lb-health-check",
		workspace: "dns-management",
		routePattern: "/manage/dns_lb_management/dns_lb_health_check",
	},
	{ resourceId: "dns-lb-pool", workspace: "dns-management", routePattern: "/manage/dns_lb_management/dns_lb_pool" },
	{
		resourceId: "dns-load-balancer",
		workspace: "dns-management",
		routePattern: "/manage/dns_lb_management/dns_load_balancer",
	},
	{ resourceId: "dns-zone", workspace: "dns-management", routePattern: "/manage/zone_management" },
	{
		resourceId: "endpoint",
		workspace: "multi-cloud-app-connect",
		routePattern: "/namespaces/{namespace}/manage/virtual_host/endpoints",
	},
	{
		resourceId: "enhanced-firewall-policy",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/firewall/enhanced_firewall_policy",
	},
	{
		resourceId: "external-connector",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/networking/external_connectivity/external_connector",
	},
	{ resourceId: "fast-acl", workspace: "multi-cloud-network-connect", routePattern: "/manage/firewall/fast_acls" },
	{
		resourceId: "fleet",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/site_management/legacy_configs/fleets",
	},
	{
		resourceId: "forward-proxy-policy",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/firewall/forward_proxy_policy",
	},
	{
		resourceId: "gcp-vpc-site",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/site_management/legacy_configs/gcp_vpc_site",
	},
	{
		resourceId: "geo-location-set",
		workspace: "dns-management",
		routePattern: "/manage/dns_lb_management/geo_location_set",
	},
	{
		resourceId: "global-log-receiver",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/log_management/log_receivers",
	},
	{
		resourceId: "healthcheck",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/load_balancers/health_checks",
	},
	{
		resourceId: "http-loadbalancer",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/load_balancers/http_loadbalancers",
	},
	{
		resourceId: "ike-gateway",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/networking/external_connectivity/ike_profiles",
	},
	{
		resourceId: "ip-prefix-set",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/shared_objects/ip_prefix_sets",
	},
	{
		resourceId: "k8s-cluster",
		workspace: "distributed-apps",
		routePattern: "/namespaces/{namespace}/manage/virtual_k8s/k8s_clusters",
	},
	{
		resourceId: "log-receiver",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/log_management/log_receivers",
	},
	{
		resourceId: "malicious-user-mitigation",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/shared_objects/malicious_user_mitigation",
	},
	{
		resourceId: "mcn-secret-policy-rule",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/secrets/secret_policy_rules",
	},
	{ resourceId: "namespace", workspace: "administration", routePattern: "/personal-management/namespaces" },
	{
		resourceId: "nat-policy",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/networking/network_configuration/nat_policy",
	},
	{
		resourceId: "network-connector",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/networking/legacy_network_configuration/network_connectors",
	},
	{
		resourceId: "network-firewall",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/firewall/network_firewall",
	},
	{
		resourceId: "network-interface",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/networking/legacy_network_configuration/network_interfaces",
	},
	{
		resourceId: "network-policy",
		workspace: "distributed-apps",
		routePattern: "/namespaces/{namespace}/manage/network_policies/network_policies",
	},
	{
		resourceId: "network-policy-rule",
		workspace: "distributed-apps",
		routePattern: "/namespaces/{namespace}/manage/network_policies/network_policy_rules",
	},
	{ resourceId: "nfv-service", workspace: "multi-cloud-network-connect", routePattern: "/manage/nfv_services" },
	{
		resourceId: "openapi-file",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/files/openapi",
	},
	{
		resourceId: "origin-pool",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/load_balancers/origin_pools",
	},
	{ resourceId: "policer", workspace: "multi-cloud-network-connect", routePattern: "/manage/firewall/policers" },
	{
		resourceId: "protocol-policer",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/firewall/protocol_policers",
	},
	{
		resourceId: "proxy",
		workspace: "multi-cloud-app-connect",
		routePattern: "/namespaces/{namespace}/manage/load_balancers/proxy",
	},
	{
		resourceId: "public-ip",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/public_ip",
	},
	{
		resourceId: "rate-limiter",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/shared_objects/rate_limiters",
	},
	{
		resourceId: "rate-limiter-policy",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/rate_limiter_policies",
	},
	{ resourceId: "role", workspace: "administration", routePattern: "/iam/roles" },
	{
		resourceId: "route",
		workspace: "multi-cloud-app-connect",
		routePattern: "/namespaces/{namespace}/manage/virtual_host/routes",
	},
	{
		resourceId: "secret-policy",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/secrets/secret_policies",
	},
	{
		resourceId: "securemesh-site",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/site_management/legacy_configs/securemesh_site",
	},
	{
		resourceId: "securemesh-site-v2",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/site_management/cloud_sites/securemesh_site_v2",
	},
	{
		resourceId: "segment",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/networking/network_configuration/segment",
	},
	{
		resourceId: "segment-connection",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/networking/network_configuration/segment_connection",
	},
	{
		resourceId: "sensitive-data-policy",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/api_security/sensitive_data_policy",
	},
	{ resourceId: "service-credential", workspace: "administration", routePattern: "/iam/service_credentials" },
	{
		resourceId: "service-policy",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/service_policies/service_policies",
	},
	{
		resourceId: "service-policy-rule",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/service_policies/service_policy_rules",
	},
	{
		resourceId: "shared-advertise-policy",
		workspace: "shared-configuration",
		routePattern: "/manage/advertise_policies",
	},
	{
		resourceId: "site-mesh-group",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/networking/site_to_site_connectivity/site_mesh_groups",
	},
	{
		resourceId: "subnet",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/networking/legacy_network_configuration/subnets",
	},
	{
		resourceId: "tcp-loadbalancer",
		workspace: "multi-cloud-app-connect",
		routePattern: "/namespaces/{namespace}/manage/load_balancers/tcp_loadbalancers",
	},
	{
		resourceId: "third-party-application",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/third_party_application",
	},
	{
		resourceId: "ticket-tracking-system",
		workspace: "shared-configuration",
		routePattern: "/manage/ticket_tracking_system",
	},
	{
		resourceId: "tunnel",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/networking/legacy_network_configuration/tunnels",
	},
	{
		resourceId: "udp-loadbalancer",
		workspace: "multi-cloud-app-connect",
		routePattern: "/namespaces/{namespace}/manage/load_balancers/udp_loadbalancers",
	},
	{
		resourceId: "usb-policy",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/site_management/other_configs/usb_policies",
	},
	{
		resourceId: "user-identification",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/shared_objects/user_identification",
	},
	{ resourceId: "v1-dns-monitor", workspace: "observability", routePattern: "/namespaces/system/manage/dns_monitors" },
	{
		resourceId: "v1-http-monitor",
		workspace: "observability",
		routePattern: "/namespaces/system/manage/monitors/http_monitors",
	},
	{
		resourceId: "virtual-host",
		workspace: "multi-cloud-app-connect",
		routePattern: "/namespaces/{namespace}/manage/virtual_host/virtual_hosts",
	},
	{
		resourceId: "virtual-k8s",
		workspace: "distributed-apps",
		routePattern: "/namespaces/{namespace}/applications/virtual_k8s",
	},
	{
		resourceId: "virtual-network",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/networking/legacy_network_configuration/virtual_networks",
	},
	{ resourceId: "virtual-site", workspace: "shared-configuration", routePattern: "/manage/virtual_sites" },
	{
		resourceId: "voltstack-site",
		workspace: "multi-cloud-network-connect",
		routePattern: "/manage/site_management/cloud_sites/appstack_site",
	},
	{
		resourceId: "waf-exclusion-policy",
		workspace: "web-app-and-api-protection",
		routePattern: "/namespaces/{namespace}/manage/shared_objects/waf_exclusion_policy",
	},
	{ resourceId: "workload-flavor", workspace: "shared-configuration", routePattern: "/manage/workload_flavors" },
];
