// AUTO-GENERATED — do not edit. Run `bun generate-terraform-index` to regenerate.
// Source: f5-sales-demo/terraform-provider-xcsh v3.91.0 81a14ce36d74f132d0d9bbd1c8392487d4bc2b39

import type { TerraformIndex } from "./terraform-types";

export const TERRAFORM_INDEX: TerraformIndex = {
	version: "0.1.0",
	provider: {
		source: "f5-sales-demo/xcsh",
		registry: "https://registry.terraform.io/providers/f5-sales-demo/xcsh",
		required_block:
			'terraform {\n  required_providers {\n    xcsh = {\n      source = "f5-sales-demo/xcsh"\n    }\n  }\n}',
		config_block: 'provider "xcsh" {}',
		auth_methods: [
			'REQUIRED: every .tf must contain a `provider "xcsh" {}` block. Without it Terraform errors: "Provider requires explicit configuration. Add a provider block".',
			"Configure exactly ONE auth method, via environment variables (preferred) or explicit arguments in the provider block:",
			"api_token (env XCSH_API_TOKEN) — API token authentication.",
			"api_p12_file + p12_password (env XCSH_P12_FILE + XCSH_P12_PASSWORD) — PKCS#12 certificate authentication.",
			"api_cert + api_key (env XCSH_CERT + XCSH_KEY) — PEM certificate authentication.",
			"api_url (env XCSH_API_URL) — tenant base URL without /api suffix, e.g. https://your-tenant.console.ves.volterra.io.",
		],
		syntax_rules: [
			"OneOf selectors: use empty block `field {}`, never `field = true`",
			"Cross-resource refs: block with name + namespace attributes",
			"Boolean attributes: use `= true` / `= false`",
			'Fields marked "Server applies default when omitted" can be safely omitted',
		],
	},
	categories: [
		{
			name: "Security",
			slug: "security",
			description: "WAF, bot defense, rate limiting, firewall policies, and security controls",
			resource_count: 27,
			resources: [
				"app_firewall",
				"alert_gen_policy",
				"alert_policy",
				"bgp_routing_policy",
				"bot_defense_app_infrastructure",
				"data_type",
				"enhanced_firewall_policy",
				"fast_acl",
				"fast_acl_rule",
				"forward_proxy_policy",
				"k8s_pod_security_policy",
				"malicious_user_mitigation",
				"nat_policy",
				"network_firewall",
				"network_policy",
				"network_policy_rule",
				"network_policy_view",
				"protocol_inspection",
				"protocol_policer",
				"rate_limiter",
				"rate_limiter_policy",
				"sensitive_data_policy",
				"service_policy",
				"service_policy_rule",
				"usb_policy",
				"user_identification",
				"waf_exclusion_policy",
			],
			dependency_chain: "namespace → app_firewall → http_loadbalancer",
		},
		{
			name: "Networking",
			slug: "networking",
			description: "Virtual networks, BGP, cloud connectivity, tunnels, and network interfaces",
			resource_count: 19,
			resources: [
				"bgp",
				"bgp_asn_set",
				"cloud_connect",
				"cloud_link",
				"dc_cluster_group",
				"external_connector",
				"forwarding_class",
				"ip_prefix_set",
				"network_connector",
				"network_interface",
				"nfv_service",
				"nginx_service_discovery",
				"policy_based_routing",
				"proxy",
				"segment",
				"srv6_network_slice",
				"subnet",
				"tunnel",
				"virtual_network",
			],
		},
		{
			name: "Load Balancing",
			slug: "load-balancing",
			description: "HTTP/TCP/UDP/CDN load balancers, origin pools, health checks, and routing",
			resource_count: 13,
			resources: [
				"healthcheck",
				"http_loadbalancer",
				"origin_pool",
				"advertise_policy",
				"cdn_cache_rule",
				"cdn_loadbalancer",
				"cdn_purge_command",
				"cluster",
				"endpoint",
				"route",
				"tcp_loadbalancer",
				"udp_loadbalancer",
				"virtual_host",
			],
			dependency_chain:
				"namespace → healthcheck → origin_pool → http_loadbalancer\nnamespace → origin_pool → tcp_loadbalancer",
		},
		{
			name: "Sites",
			slug: "sites",
			description: "AWS/Azure/GCP VPC sites, SecureMesh, VoltStack, and site mesh groups",
			resource_count: 11,
			resources: [
				"aws_tgw_site",
				"aws_vpc_site",
				"azure_vnet_site",
				"fleet",
				"gcp_vpc_site",
				"registration",
				"securemesh_site",
				"securemesh_site_v2",
				"site_mesh_group",
				"virtual_site",
				"voltstack_site",
			],
		},
		{
			name: "Kubernetes",
			slug: "kubernetes",
			description: "Container registries, workloads, and Kubernetes integrations",
			resource_count: 8,
			resources: [
				"container_registry",
				"k8s_cluster",
				"k8s_cluster_role",
				"k8s_cluster_role_binding",
				"k8s_pod_security_admission",
				"virtual_k8s",
				"workload",
				"workload_flavor",
			],
		},
		{
			name: "Uncategorized",
			slug: "uncategorized",
			description: "Resources pending categorization",
			resource_count: 7,
			resources: [
				"application_profiles",
				"authorization_server",
				"bot_infrastructure",
				"mitigated_domain",
				"protected_application",
				"protected_domain",
				"registration_approval",
			],
		},
		{
			name: "DNS",
			slug: "dns",
			description: "DNS domains, zones, compliance checks, and DNS proxy configuration",
			resource_count: 6,
			resources: [
				"dns_compliance_checks",
				"dns_lb_health_check",
				"dns_lb_pool",
				"dns_load_balancer",
				"dns_proxy",
				"dns_zone",
			],
		},
		{
			name: "API Security",
			slug: "api-security",
			description: "API definition, discovery, testing, and security controls for web APIs",
			resource_count: 5,
			resources: ["api_crawler", "api_definition", "api_discovery", "api_testing", "app_api_group"],
		},
		{
			name: "Applications",
			slug: "applications",
			description: "Application settings, types, discovery, and filtering",
			resource_count: 4,
			resources: ["app_setting", "app_type", "discovery", "filter_set"],
		},
		{
			name: "Authentication",
			slug: "authentication",
			description: "Authentication methods, cloud credentials, and secret management",
			resource_count: 4,
			resources: ["authentication", "cloud_credentials", "secret_management_access", "token"],
		},
		{
			name: "Certificates",
			slug: "certificates",
			description: "TLS certificates, certificate chains, CRLs, and trusted CA lists",
			resource_count: 4,
			resources: ["certificate", "certificate_chain", "crl", "trusted_ca_list"],
		},
		{
			name: "Monitoring",
			slug: "monitoring",
			description: "Log receivers, alert policies, alert templates, and global logging configuration",
			resource_count: 4,
			resources: ["alert_receiver", "alert_template", "global_log_receiver", "log_receiver"],
		},
		{
			name: "VPN",
			slug: "vpn",
			description: "VPN and IPSec configuration",
			resource_count: 4,
			resources: ["ike1", "ike2", "ike_phase1_profile", "ike_phase2_profile"],
		},
		{
			name: "BIG-IP Integration",
			slug: "big-ip-integration",
			description: "BIG-IP proxy, data groups, and iRules integration",
			resource_count: 3,
			resources: ["bigip_http_proxy", "data_group", "irule"],
		},
		{
			name: "Cloud Resources",
			slug: "cloud-resources",
			description: "Cloud elastic IPs, address allocators, and geo-location resources",
			resource_count: 3,
			resources: ["address_allocator", "cloud_elastic_ip", "geo_location_set"],
		},
		{
			name: "Organization",
			slug: "organization",
			description: "Namespaces, tenant configuration, and organizational settings",
			resource_count: 3,
			resources: ["allowed_domain", "namespace", "tenant_configuration"],
		},
		{
			name: "Integrations",
			slug: "integrations",
			description: "External integrations including code base and ticket tracking",
			resource_count: 1,
			resources: ["code_base_integration"],
		},
		{
			name: "Service Mesh",
			slug: "service-mesh",
			description: "Service mesh policies and traffic management",
			resource_count: 1,
			resources: ["policer"],
		},
		{
			name: "Subscriptions",
			slug: "subscriptions",
			description: "Cloud subscription management and metering",
			resource_count: 1,
			resources: ["cminstance"],
		},
	],
	resources: [
		{
			name: "app_firewall",
			category: "security",
			description: "Application Firewall",
			required: ["name", "namespace"],
			server_defaults: [
				"allow_all_response_codes",
				"default_anonymization",
				"default_bot_setting",
				"default_detection_settings",
				"disable_ai_enhancements",
				"monitoring",
				"use_default_blocking_page",
			],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/app_firewall.txt#minimal-valid-config",
			},
			dependencies: {
				requires: ["namespace"],
			},
			import_syntax: "terraform import xcsh_app_firewall.example namespace/name",
		},
		{
			name: "alert_gen_policy",
			category: "security",
			description: "Alert Generation Policy",
			required: ["name", "namespace", "alert_status"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/alert_gen_policy.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_alert_gen_policy.example namespace/name",
		},
		{
			name: "alert_policy",
			category: "security",
			description: "New Alert Policy Object",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/alert_policy.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_alert_policy.example namespace/name",
		},
		{
			name: "bgp_routing_policy",
			category: "security",
			description:
				"Bgp routing policy is a list of rules containing match criteria and action to be applied. these rules help control routes which are imported or exported to bgp peers. configuration",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/bgp_routing_policy.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_bgp_routing_policy.example namespace/name",
		},
		{
			name: "bot_defense_app_infrastructure",
			category: "security",
			description: "Bot Defense App Infrastructure in a given namespace",
			required: ["name", "namespace", "environment_type", "traffic_type"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/bot_defense_app_infrastructure.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_bot_defense_app_infrastructure.example namespace/name",
		},
		{
			name: "data_type",
			category: "security",
			description: "Data_type creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace", "is_pii", "is_sensitive_data"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/data_type.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_data_type.example namespace/name",
		},
		{
			name: "enhanced_firewall_policy",
			category: "security",
			description: "Enhanced firewall policy specification. configuration",
			required: ["name", "namespace"],
			server_defaults: ["allow_all"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/enhanced_firewall_policy.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_enhanced_firewall_policy.example namespace/name",
		},
		{
			name: "fast_acl",
			category: "security",
			description:
				"Object, object contains rules to protect site from denial of service It has destination{destination IP, destination port) and references to",
			required: ["name"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/fast_acl.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_fast_acl.example namespace/name",
		},
		{
			name: "fast_acl_rule",
			category: "security",
			description: "New Fast ACL rule, has specification to match source IP, source port and action to apply",
			required: ["name"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/fast_acl_rule.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_fast_acl_rule.example namespace/name",
		},
		{
			name: "forward_proxy_policy",
			category: "security",
			description: "Forward proxy policy specification. configuration",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/forward_proxy_policy.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_forward_proxy_policy.example namespace/name",
		},
		{
			name: "k8s_pod_security_policy",
			category: "security",
			description:
				"K8s_pod_security_policy will create the object in the storage backend for namespace metadata.namespace",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/k8s_pod_security_policy.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_k8s_pod_security_policy.example namespace/name",
		},
		{
			name: "malicious_user_mitigation",
			category: "security",
			description: "Malicious_user_mitigation creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace"],
			server_defaults: ["mitigation_type"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/malicious_user_mitigation.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_malicious_user_mitigation.example namespace/name",
		},
		{
			name: "nat_policy",
			category: "security",
			description: "Nat policy create specification configures nat policy with multiple rules,. configuration",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/nat_policy.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_nat_policy.example namespace/name",
		},
		{
			name: "network_firewall",
			category: "security",
			description: "Network firewall is created by users in system namespace. configuration",
			required: ["name", "namespace"],
			server_defaults: ["disable_fast_acl", "disable_forward_proxy_policy", "disable_network_policy"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/network_firewall.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_network_firewall.example namespace/name",
		},
		{
			name: "network_policy",
			category: "security",
			description: "New network policy with configured parameters in specified namespace",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/network_policy.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_network_policy.example namespace/name",
		},
		{
			name: "network_policy_rule",
			category: "security",
			description: "Network policy rule with configured parameters in specified namespace",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/network_policy_rule.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_network_policy_rule.example namespace/name",
		},
		{
			name: "network_policy_view",
			category: "security",
			description: "Network policy view specification. configuration",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/network_policy_view.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_network_policy_view.example namespace/name",
		},
		{
			name: "protocol_inspection",
			category: "security",
			description:
				"Protocol Inspection Specification in a given namespace. If one already exists it will give an error",
			required: ["name", "namespace", "enable_disable_compliance_checks", "enable_disable_signatures"],
			server_defaults: ["action"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/protocol_inspection.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_protocol_inspection.example namespace/name",
		},
		{
			name: "protocol_policer",
			category: "security",
			description:
				"Protocol_policer object, protocol_policer object contains list of L4 protocol match condition and corresponding traffic rate limits",
			required: ["name"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/protocol_policer.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_protocol_policer.example namespace/name",
		},
		{
			name: "rate_limiter",
			category: "security",
			description: "Rate_limiter creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace"],
			server_defaults: ["user_identification"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/rate_limiter.txt#minimal-valid-config",
			},
			dependencies: {
				requires: ["namespace"],
			},
			import_syntax: "terraform import xcsh_rate_limiter.example namespace/name",
		},
		{
			name: "rate_limiter_policy",
			category: "security",
			description: "Rate limiter policy create specification. configuration",
			required: ["name", "namespace", "burst_size", "committed_information_rate"],
			server_defaults: ["rules"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/rate_limiter_policy.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_rate_limiter_policy.example namespace/name",
		},
		{
			name: "sensitive_data_policy",
			category: "security",
			description: "Sensitive_data_policy creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace"],
			server_defaults: ["compliances", "custom_data_types", "disabled_predefined_data_types"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/sensitive_data_policy.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_sensitive_data_policy.example namespace/name",
		},
		{
			name: "service_policy",
			category: "security",
			description: "Service_policy creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace"],
			server_defaults: ["port_matcher"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/service_policy.txt#minimal-valid-config",
			},
			dependencies: {
				requires: ["namespace"],
			},
			import_syntax: "terraform import xcsh_service_policy.example namespace/name",
		},
		{
			name: "service_policy_rule",
			category: "security",
			description: "Service_policy_rule creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/service_policy_rule.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_service_policy_rule.example namespace/name",
		},
		{
			name: "usb_policy",
			category: "security",
			description: "New USB policy object",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/usb_policy.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_usb_policy.example namespace/name",
		},
		{
			name: "user_identification",
			category: "security",
			description: "User_identification creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace", "rules"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/user_identification.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_user_identification.example namespace/name",
		},
		{
			name: "waf_exclusion_policy",
			category: "security",
			description: "WAF exclusion policy",
			required: ["name", "namespace", "waf_exclusion_rules"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/waf_exclusion_policy.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_waf_exclusion_policy.example namespace/name",
		},
		{
			name: "bgp",
			category: "networking",
			description:
				"Bgp object is the configuration for peering with external bgp servers. it is created by users in system namespace. configuration",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/bgp.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_bgp.example namespace/name",
		},
		{
			name: "bgp_asn_set",
			category: "networking",
			description: "Bgp_asn_set creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/bgp_asn_set.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_bgp_asn_set.example namespace/name",
		},
		{
			name: "cloud_connect",
			category: "networking",
			description: "Establishing connectivity to cloud provider networks",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/cloud_connect.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_cloud_connect.example namespace/name",
		},
		{
			name: "cloud_link",
			category: "networking",
			description: "New CloudLink with configured parameters",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/cloud_link.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_cloud_link.example namespace/name",
		},
		{
			name: "dc_cluster_group",
			category: "networking",
			description: "DC Cluster group in given namespace",
			required: ["name"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/dc_cluster_group.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_dc_cluster_group.example namespace/name",
		},
		{
			name: "external_connector",
			category: "networking",
			description: "External_connector configuration specification. configuration",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/external_connector.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_external_connector.example namespace/name",
		},
		{
			name: "forwarding_class",
			category: "networking",
			description: "Forwarding class is created by users in system namespace. configuration",
			required: ["name", "namespace", "queue_id_to_use", "interface_group"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/forwarding_class.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_forwarding_class.example namespace/name",
		},
		{
			name: "ip_prefix_set",
			category: "networking",
			description: "Ip_prefix_set creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/ip_prefix_set.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_ip_prefix_set.example namespace/name",
		},
		{
			name: "network_connector",
			category: "networking",
			description: "Network connector is created by users in system namespace. configuration",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/network_connector.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_network_connector.example namespace/name",
		},
		{
			name: "network_interface",
			category: "networking",
			description:
				"Network interface represents configuration of a network device. it is created by users in system namespace. configuration",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/network_interface.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_network_interface.example namespace/name",
		},
		{
			name: "nfv_service",
			category: "networking",
			description: "New NFV service with configured parameters",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/nfv_service.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_nfv_service.example namespace/name",
		},
		{
			name: "nginx_service_discovery",
			category: "networking",
			description:
				"Api to create nginx service discovery object for a site or virtual site in system namespace. configuration",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/nginx_service_discovery.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_nginx_service_discovery.example namespace/name",
		},
		{
			name: "policy_based_routing",
			category: "networking",
			description: "Network policy based routing create specification. configuration",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/policy_based_routing.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_policy_based_routing.example namespace/name",
		},
		{
			name: "proxy",
			category: "networking",
			description: "Tcp loadbalancer create specification. configuration",
			required: ["name", "namespace", "connection_timeout"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/proxy.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_proxy.example namespace/name",
		},
		{
			name: "segment",
			category: "networking",
			description: "Segment. configuration",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/segment.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_segment.example namespace/name",
		},
		{
			name: "srv6_network_slice",
			category: "networking",
			description: "Srv6_network_slice creates a new object in the storage backend for metadata.namespace",
			required: [
				"name",
				"namespace",
				"connect_to_access_networks",
				"connect_to_enterprise_networks",
				"connect_to_internet",
			],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/srv6_network_slice.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_srv6_network_slice.example namespace/name",
		},
		{
			name: "subnet",
			category: "networking",
			description:
				"Subnet object contains configuration for an interface of a vm/pod. it is created in user or shared namespace. configuration",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/subnet.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_subnet.example namespace/name",
		},
		{
			name: "tunnel",
			category: "networking",
			description: "Tunnel in a given namespace. If one already exist it will give a error",
			required: ["name", "namespace", "tunnel_type"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/tunnel.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_tunnel.example namespace/name",
		},
		{
			name: "virtual_network",
			category: "networking",
			description: "Virtual network in given namespace",
			required: ["name", "legacy_type"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/virtual_network.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_virtual_network.example namespace/name",
		},
		{
			name: "healthcheck",
			category: "load-balancing",
			description:
				"Healthcheck object defines method to determine if the given endpoint is healthy. single healthcheck object can be referred to by one or many cluster objects. configuration",
			required: ["name", "namespace", "interval", "timeout", "healthy_threshold", "unhealthy_threshold"],
			server_defaults: [
				"http_health_check.expected_response",
				"http_health_check.expected_status_codes",
				"http_health_check.headers",
				"http_health_check.request_headers_to_remove",
				"http_health_check.use_http2",
				"http_health_check.use_origin_server_name",
				"jitter_percent",
			],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/healthcheck.txt#minimal-valid-config",
			},
			dependencies: {
				requires: ["namespace"],
				used_by: ["origin_pool"],
			},
			import_syntax: "terraform import xcsh_healthcheck.example namespace/name",
		},
		{
			name: "http_loadbalancer",
			category: "load-balancing",
			description: "Load balancing HTTP/HTTPS traffic with routing and security controls",
			required: ["name", "namespace", "domains"],
			server_defaults: [
				"add_location",
				"default_pool.advanced_options.auto_http_config",
				"default_pool.advanced_options.connection_timeout",
				"default_pool.advanced_options.default_circuit_breaker",
				"default_pool.advanced_options.disable_outlier_detection",
				"default_pool.advanced_options.disable_subsets",
				"default_pool.advanced_options.http_idle_timeout",
				"default_pool.advanced_options.no_panic_threshold",
				"default_pool.advanced_options.no_request_limit_per_connection",
				"default_pool.endpoint_selection",
				"default_pool.healthcheck",
				"default_pool.loadbalancer_algorithm",
				"default_pool.no_tls",
				"default_pool.same_as_endpoint_port",
				"default_pool.use_tls.default_session_key_caching",
				"default_pool.use_tls.no_mtls",
				"default_pool.use_tls.use_host_header_as_sni",
				"default_pool.use_tls.volterra_trusted_ca",
				"default_sensitive_data_policy",
				"disable_api_definition",
				"disable_api_discovery",
				"disable_api_testing",
				"disable_bot_defense",
				"disable_ip_reputation",
				"disable_malicious_user_detection",
				"disable_malware_protection",
				"disable_rate_limit",
				"disable_threat_mesh",
				"disable_trust_client_ip_headers",
				"disable_waf",
				"https_auto_cert.add_hsts",
				"https_auto_cert.connection_idle_timeout",
				"https_auto_cert.enable_path_normalize",
				"https_auto_cert.http_redirect",
				"https_auto_cert.no_mtls",
				"l7_ddos_protection",
				"no_challenge",
				"rate_limit.no_ip_allowed_list",
				"rate_limit.no_policies",
				"rate_limit.rate_limiter.period_multiplier",
				"round_robin",
				"service_policies_from_namespace",
				"user_id_client_ip",
			],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/http_loadbalancer.txt#minimal-valid-config",
			},
			dependencies: {
				requires: ["namespace", "origin_pool"],
				used_by: ["route"],
			},
			import_syntax: "terraform import xcsh_http_loadbalancer.example namespace/name",
		},
		{
			name: "origin_pool",
			category: "load-balancing",
			description: "Defining backend server pools for load balancer targets",
			required: ["name", "namespace", "origin_servers", "port"],
			server_defaults: [
				"advanced_options.auto_http_config",
				"advanced_options.connection_timeout",
				"advanced_options.default_circuit_breaker",
				"advanced_options.disable_outlier_detection",
				"advanced_options.disable_subsets",
				"advanced_options.http_idle_timeout",
				"advanced_options.no_panic_threshold",
				"advanced_options.no_request_limit_per_connection",
				"endpoint_selection",
				"healthcheck",
				"loadbalancer_algorithm",
				"no_tls",
				"same_as_endpoint_port",
				"use_tls.default_session_key_caching",
				"use_tls.no_mtls",
				"use_tls.use_host_header_as_sni",
				"use_tls.volterra_trusted_ca",
			],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/origin_pool.txt#minimal-valid-config",
			},
			dependencies: {
				requires: ["namespace", "healthcheck"],
				used_by: ["http_loadbalancer", "tcp_loadbalancer", "udp_loadbalancer"],
			},
			import_syntax: "terraform import xcsh_origin_pool.example namespace/name",
		},
		{
			name: "advertise_policy",
			category: "load-balancing",
			description:
				"Advertise_policy object controls how and where a service represented by a given virtual_host object is advertised to consumers. configuration",
			required: ["name", "namespace", "address", "protocol", "skip_xff_append"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/advertise_policy.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_advertise_policy.example namespace/name",
		},
		{
			name: "cdn_cache_rule",
			category: "load-balancing",
			description: "CDN loadbalancer specification. configuration",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/cdn_cache_rule.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_cdn_cache_rule.example namespace/name",
		},
		{
			name: "cdn_loadbalancer",
			category: "load-balancing",
			description: "Content delivery and edge caching with load balancing",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/cdn_loadbalancer.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_cdn_loadbalancer.example namespace/name",
		},
		{
			name: "cdn_purge_command",
			category: "load-balancing",
			description: "CDN purge command specification. configuration",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/cdn_purge_command.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_cdn_purge_command.example namespace/name",
		},
		{
			name: "cluster",
			category: "load-balancing",
			description: "Cluster will create the object in the storage backend for namespace metadata.namespace",
			required: [
				"name",
				"namespace",
				"connection_timeout",
				"endpoint_selection",
				"fallback_policy",
				"http_idle_timeout",
				"loadbalancer_algorithm",
			],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/cluster.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_cluster.example namespace/name",
		},
		{
			name: "endpoint",
			category: "load-balancing",
			description: "Endpoint will create the object in the storage backend for namespace metadata.namespace",
			required: ["name", "namespace", "health_check_port", "port", "protocol"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/endpoint.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_endpoint.example namespace/name",
		},
		{
			name: "route",
			category: "load-balancing",
			description:
				"Route object in a given namespace. Route object is list of route rules. Each rule has match condition to match incoming requests and actions to take on matching requests",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/route.txt#minimal-valid-config",
			},
			dependencies: {
				requires: ["namespace", "http_loadbalancer"],
			},
			import_syntax: "terraform import xcsh_route.example namespace/name",
		},
		{
			name: "tcp_loadbalancer",
			category: "load-balancing",
			description: "Load balancing TCP traffic across origin pools",
			required: ["name", "namespace", "origin_pools"],
			server_defaults: [
				"dns_volterra_managed",
				"hash_policy_choice_round_robin",
				"idle_timeout",
				"no_sni",
				"retract_cluster",
				"service_policies_from_namespace",
				"tcp",
			],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/tcp_loadbalancer.txt#minimal-valid-config",
			},
			dependencies: {
				requires: ["namespace", "origin_pool"],
			},
			import_syntax: "terraform import xcsh_tcp_loadbalancer.example namespace/name",
		},
		{
			name: "udp_loadbalancer",
			category: "load-balancing",
			description: "Load balancing UDP traffic across origin pools",
			required: ["name", "namespace", "dns_volterra_managed", "idle_timeout"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/udp_loadbalancer.txt#minimal-valid-config",
			},
			dependencies: {
				requires: ["namespace", "origin_pool"],
			},
			import_syntax: "terraform import xcsh_udp_loadbalancer.example namespace/name",
		},
		{
			name: "virtual_host",
			category: "load-balancing",
			description: "Virtual host in a given namespace",
			required: [
				"name",
				"namespace",
				"add_location",
				"connection_idle_timeout",
				"disable_default_error_pages",
				"disable_dns_resolve",
				"idle_timeout",
				"max_request_header_size",
				"proxy",
			],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/virtual_host.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_virtual_host.example namespace/name",
		},
		{
			name: "aws_tgw_site",
			category: "sites",
			description: "Deploying F5 sites connected via AWS Transit Gateway",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/aws_tgw_site.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_aws_tgw_site.example namespace/name",
		},
		{
			name: "aws_vpc_site",
			category: "sites",
			description: "Deploying F5 sites within AWS VPC environments",
			required: ["name", "namespace", "address", "aws_region", "disk_size", "instance_type", "ssh_key"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/aws_vpc_site.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_aws_vpc_site.example namespace/name",
		},
		{
			name: "azure_vnet_site",
			category: "sites",
			description: "Deploying F5 sites within Azure Virtual Network environments",
			required: ["name", "namespace", "machine_type", "resource_group", "ssh_key"],
			server_defaults: [
				"block_all_services",
				"disk_size",
				"ingress_gw.accelerated_networking",
				"ingress_gw.performance_enhancement_mode",
				"logs_streaming_disabled",
				"machine_type",
				"no_worker_nodes",
				"tags",
			],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/azure_vnet_site.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_azure_vnet_site.example namespace/name",
		},
		{
			name: "fleet",
			category: "sites",
			description: "Fleet will create a fleet object in 'system' namespace of the user",
			required: [
				"name",
				"namespace",
				"enable_default_fleet_config_download",
				"fleet_label",
				"operating_system_version",
				"volterra_software_version",
			],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/fleet.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_fleet.example namespace/name",
		},
		{
			name: "gcp_vpc_site",
			category: "sites",
			description: "Deploying F5 sites within Google Cloud VPC environments",
			required: ["name", "namespace", "address", "disk_size", "gcp_region", "instance_type", "ssh_key"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/gcp_vpc_site.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_gcp_vpc_site.example namespace/name",
		},
		{
			name: "registration",
			category: "sites",
			description: "Vpm creates registration using this message, never used by users. configuration",
			required: ["name", "namespace", "token"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/registration.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_registration.example namespace/name",
		},
		{
			name: "securemesh_site",
			category: "sites",
			description: "Deploying secure mesh edge sites with distributed security",
			required: ["name", "namespace", "address", "volterra_certified_hw"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/securemesh_site.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_securemesh_site.example namespace/name",
		},
		{
			name: "securemesh_site_v2",
			category: "sites",
			description: "Deploying secure mesh edge sites with security and networking controls",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/securemesh_site_v2.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_securemesh_site_v2.example namespace/name",
		},
		{
			name: "site_mesh_group",
			category: "sites",
			description: "Site Mesh Group in system namespace of user",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/site_mesh_group.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_site_mesh_group.example namespace/name",
		},
		{
			name: "virtual_site",
			category: "sites",
			description: "Virtual site object in given namespace",
			required: ["name", "namespace", "site_type", "site_selector"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/virtual_site.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_virtual_site.example namespace/name",
		},
		{
			name: "voltstack_site",
			category: "sites",
			description: "Deploying App Stack edge computing sites",
			required: ["name", "namespace", "address", "volterra_certified_hw"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/voltstack_site.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_voltstack_site.example namespace/name",
		},
		{
			name: "container_registry",
			category: "kubernetes",
			description: "Container image registry configuration",
			required: ["name", "namespace", "email", "registry", "user_name"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/container_registry.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_container_registry.example namespace/name",
		},
		{
			name: "k8s_cluster",
			category: "kubernetes",
			description: "K8s_cluster will create the object in the storage backend for namespace metadata.namespace",
			required: ["name", "namespace"],
			server_defaults: [
				"cluster_scoped_access_deny",
				"no_cluster_wide_apps",
				"no_global_access",
				"no_insecure_registries",
				"no_local_access",
				"use_default_cluster_role_bindings",
				"use_default_cluster_roles",
				"use_default_psp",
				"vk8s_namespace_access_deny",
			],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/k8s_cluster.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_k8s_cluster.example namespace/name",
		},
		{
			name: "k8s_cluster_role",
			category: "kubernetes",
			description: "K8s_cluster_role will create the object in the storage backend for namespace metadata.namespace",
			required: ["name"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/k8s_cluster_role.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_k8s_cluster_role.example namespace/name",
		},
		{
			name: "k8s_cluster_role_binding",
			category: "kubernetes",
			description:
				"K8s_cluster_role_binding will create the object in the storage backend for namespace metadata.namespace",
			required: ["name"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/k8s_cluster_role_binding.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_k8s_cluster_role_binding.example namespace/name",
		},
		{
			name: "k8s_pod_security_admission",
			category: "kubernetes",
			description: "K8s_pod_security_admission will create the object in the storage backend",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/k8s_pod_security_admission.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_k8s_pod_security_admission.example namespace/name",
		},
		{
			name: "virtual_k8s",
			category: "kubernetes",
			description: "Virtual_k8s will create the object in the storage backend for namespace metadata.namespace",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/virtual_k8s.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_virtual_k8s.example namespace/name",
		},
		{
			name: "workload",
			category: "kubernetes",
			description: "Workload. configuration",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/workload.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_workload.example namespace/name",
		},
		{
			name: "workload_flavor",
			category: "kubernetes",
			description: "Workload_flavor",
			required: ["name", "namespace", "ephemeral_storage", "memory", "vcpus"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/workload_flavor.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_workload_flavor.example namespace/name",
		},
		{
			name: "application_profiles",
			category: "uncategorized",
			description: "Application Profiles in a given namespace. If one already exists it will give an error",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/application_profiles.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_application_profiles.example namespace/name",
		},
		{
			name: "authorization_server",
			category: "uncategorized",
			description: "Authorization_server creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace", "jwks_uri"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/authorization_server.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_authorization_server.example namespace/name",
		},
		{
			name: "bot_infrastructure",
			category: "uncategorized",
			description: "Bot Infrastructure",
			required: ["name", "namespace", "traffic_type"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/bot_infrastructure.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_bot_infrastructure.example namespace/name",
		},
		{
			name: "mitigated_domain",
			category: "uncategorized",
			description: "Mitigated Domain",
			required: ["name", "namespace", "mitigated_domain"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/mitigated_domain.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_mitigated_domain.example namespace/name",
		},
		{
			name: "protected_application",
			category: "uncategorized",
			description: "Applications protected by Bot Defense",
			required: ["name", "namespace", "region"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/protected_application.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_protected_application.example namespace/name",
		},
		{
			name: "protected_domain",
			category: "uncategorized",
			description: "Domain to protect",
			required: ["name", "namespace", "protected_domain"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/protected_domain.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_protected_domain.example namespace/name",
		},
		{
			name: "registration_approval",
			category: "uncategorized",
			description: "Request for admission approval. configuration",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/registration_approval.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_registration_approval.example namespace/name",
		},
		{
			name: "dns_compliance_checks",
			category: "dns",
			description:
				"DNS Compliance Checks Specification in a given namespace. If one already exists it will give an error",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/dns_compliance_checks.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_dns_compliance_checks.example namespace/name",
		},
		{
			name: "dns_lb_health_check",
			category: "dns",
			description: "DNS Load Balancer Health Check in a given namespace. If one already exist it will give a error",
			required: ["name"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/dns_lb_health_check.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_dns_lb_health_check.example namespace/name",
		},
		{
			name: "dns_lb_pool",
			category: "dns",
			description: "DNS Load Balancer Pool in a given namespace. If one already exist it will give a error",
			required: ["name", "load_balancing_mode"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/dns_lb_pool.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_dns_lb_pool.example namespace/name",
		},
		{
			name: "dns_load_balancer",
			category: "dns",
			description: "DNS Load Balancer in a given namespace. If one already exist it will give a error",
			required: ["name"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/dns_load_balancer.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_dns_load_balancer.example namespace/name",
		},
		{
			name: "dns_proxy",
			category: "dns",
			description: "DNS Proxy in a given namespace. If one already exists it will give an error",
			required: ["name", "transport_type"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/dns_proxy.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_dns_proxy.example namespace/name",
		},
		{
			name: "dns_zone",
			category: "dns",
			description: "DNS Zone in a given namespace. If one already exist it will give a error",
			required: ["name"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/dns_zone.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_dns_zone.example namespace/name",
		},
		{
			name: "api_crawler",
			category: "api-security",
			description: "API Crawler resource",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/api_crawler.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_api_crawler.example namespace/name",
		},
		{
			name: "api_definition",
			category: "api-security",
			description: "API Definition",
			required: ["name", "namespace"],
			server_defaults: [
				"api_inventory_exclusion_list",
				"api_inventory_inclusion_list",
				"non_api_endpoints",
				"strict_schema_origin",
				"swagger_specs",
			],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/api_definition.txt#minimal-valid-config",
			},
			dependencies: {
				requires: ["namespace"],
			},
			import_syntax: "terraform import xcsh_api_definition.example namespace/name",
		},
		{
			name: "api_discovery",
			category: "api-security",
			description: "API discovery creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace", "user_defined_api_discovery_policy"],
			server_defaults: [
				"custom_auth_types",
				"user_defined_api_discovery_policy.discovery_rules",
				"user_defined_api_discovery_policy.inclusive",
			],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/api_discovery.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_api_discovery.example namespace/name",
		},
		{
			name: "api_testing",
			category: "api-security",
			description: "API Testing resource",
			required: ["name", "namespace", "custom_header_value"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/api_testing.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_api_testing.example namespace/name",
		},
		{
			name: "app_api_group",
			category: "api-security",
			description: "App_api_group creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/app_api_group.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_app_api_group.example namespace/name",
		},
		{
			name: "app_setting",
			category: "applications",
			description: "App setting configuration in namespace metadata.namespace",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/app_setting.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_app_setting.example namespace/name",
		},
		{
			name: "app_type",
			category: "applications",
			description: "App type will create the configuration in namespace metadata.namespace",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/app_type.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_app_type.example namespace/name",
		},
		{
			name: "discovery",
			category: "applications",
			description: "Api to create discovery object for a site or virtual site in system namespace. configuration",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/discovery.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_discovery.example namespace/name",
		},
		{
			name: "filter_set",
			category: "applications",
			description: "Specification",
			required: ["name", "namespace", "context_key"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/filter_set.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_filter_set.example namespace/name",
		},
		{
			name: "authentication",
			category: "authentication",
			description: "Authentication resource",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/authentication.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_authentication.example namespace/name",
		},
		{
			name: "cloud_credentials",
			category: "authentication",
			description: "Api to create cloud_credentials object. configuration",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/cloud_credentials.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_cloud_credentials.example namespace/name",
		},
		{
			name: "secret_management_access",
			category: "authentication",
			description: "Secret_management_access creates a new object in storage backend for metadata.namespace",
			required: ["name", "namespace", "provider_name"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/secret_management_access.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_secret_management_access.example namespace/name",
		},
		{
			name: "token",
			category: "authentication",
			description:
				"New token. Token object is used to manage site admission. User must generate token before provisioning and pass this token to site during it's registration",
			required: ["name"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/token.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_token.example namespace/name",
		},
		{
			name: "certificate",
			category: "certificates",
			description: "Certificate. configuration",
			required: ["name", "namespace", "certificate_url", "private_key"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/certificate.txt#minimal-valid-config",
			},
			dependencies: {
				requires: ["namespace"],
			},
			import_syntax: "terraform import xcsh_certificate.example namespace/name",
		},
		{
			name: "certificate_chain",
			category: "certificates",
			description: "Certificate chain configuration for TLS",
			required: ["name", "namespace", "certificate_url"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/certificate_chain.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_certificate_chain.example namespace/name",
		},
		{
			name: "crl",
			category: "certificates",
			description: "Api to create crl object. configuration",
			required: ["name", "namespace", "refresh_interval", "server_address", "server_port", "timeout"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/crl.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_crl.example namespace/name",
		},
		{
			name: "trusted_ca_list",
			category: "certificates",
			description: "Trusted certificate authority list management",
			required: ["name", "namespace", "trusted_ca_url"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/trusted_ca_list.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_trusted_ca_list.example namespace/name",
		},
		{
			name: "alert_receiver",
			category: "monitoring",
			description: "New Alert Receiver object",
			required: ["name", "namespace", "receiver_choice"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/alert_receiver.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_alert_receiver.example namespace/name",
		},
		{
			name: "alert_template",
			category: "monitoring",
			description: "Domain to protect",
			required: ["name", "namespace", "alert_message", "alert_message_details", "alert_name", "severity"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/alert_template.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_alert_template.example namespace/name",
		},
		{
			name: "global_log_receiver",
			category: "monitoring",
			description: "New Global Log Receiver object",
			required: ["name", "namespace", "log_type", "receiver_choice"],
			server_defaults: ["ns_current", "request_logs.sampled"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/global_log_receiver.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_global_log_receiver.example namespace/name",
		},
		{
			name: "log_receiver",
			category: "monitoring",
			description: "New Log Receiver object",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/log_receiver.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_log_receiver.example namespace/name",
		},
		{
			name: "ike1",
			category: "vpn",
			description: "Ike phase1 profile specification. configuration",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/ike1.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_ike1.example namespace/name",
		},
		{
			name: "ike2",
			category: "vpn",
			description: "Ike phase2 profile specification. configuration",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/ike2.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_ike2.example namespace/name",
		},
		{
			name: "ike_phase1_profile",
			category: "vpn",
			description: "Ike phase1 profile specification. configuration",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/ike_phase1_profile.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_ike_phase1_profile.example namespace/name",
		},
		{
			name: "ike_phase2_profile",
			category: "vpn",
			description: "Ike phase2 profile specification. configuration",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/ike_phase2_profile.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_ike_phase2_profile.example namespace/name",
		},
		{
			name: "bigip_http_proxy",
			category: "big-ip-integration",
			description: "BIG-IP HTTP Proxy in a given namespace. If one already exists, it will give an error",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/bigip_http_proxy.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_bigip_http_proxy.example namespace/name",
		},
		{
			name: "data_group",
			category: "big-ip-integration",
			description: "Data group in a given namespace. If one already exists it will give an error",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/data_group.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_data_group.example namespace/name",
		},
		{
			name: "irule",
			category: "big-ip-integration",
			description: "IRule in a given namespace. If one already exists it will give an error",
			required: ["name", "namespace", "description", "description_spec", "irule"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/irule.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_irule.example namespace/name",
		},
		{
			name: "address_allocator",
			category: "cloud-resources",
			description: "Address Allocator will create an address allocator object in 'system' namespace of the user",
			required: ["name", "namespace", "mode"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/address_allocator.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_address_allocator.example namespace/name",
		},
		{
			name: "cloud_elastic_ip",
			category: "cloud-resources",
			description: "Cloud Elastic IP creates Cloud Elastic IP object Object is attached to a site",
			required: ["name", "namespace", "item_count"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/cloud_elastic_ip.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_cloud_elastic_ip.example namespace/name",
		},
		{
			name: "geo_location_set",
			category: "cloud-resources",
			description: "Geolocation Set",
			required: ["name"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/geo_location_set.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_geo_location_set.example namespace/name",
		},
		{
			name: "allowed_domain",
			category: "organization",
			description: "Allowed domain",
			required: ["name", "namespace", "allowed_domain"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/allowed_domain.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_allowed_domain.example namespace/name",
		},
		{
			name: "namespace",
			category: "organization",
			description: "New namespace. Name of the object is name of the namespace",
			required: ["name"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/namespace.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
				used_by: [
					"api_definition",
					"app_firewall",
					"certificate",
					"healthcheck",
					"http_loadbalancer",
					"origin_pool",
					"rate_limiter",
					"route",
					"service_policy",
					"tcp_loadbalancer",
					"udp_loadbalancer",
				],
			},
			import_syntax: "terraform import xcsh_namespace.example namespace/name",
		},
		{
			name: "tenant_configuration",
			category: "organization",
			description: "Tenant configuration specification. configuration",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/tenant_configuration.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_tenant_configuration.example namespace/name",
		},
		{
			name: "code_base_integration",
			category: "integrations",
			description: "Integration details",
			required: ["name", "namespace"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/code_base_integration.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_code_base_integration.example namespace/name",
		},
		{
			name: "policer",
			category: "service-mesh",
			description: "New policer with traffic rate limits",
			required: ["name", "namespace", "burst_size", "committed_information_rate"],
			server_defaults: ["policer_mode", "policer_type"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/policer.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_policer.example namespace/name",
		},
		{
			name: "cminstance",
			category: "subscriptions",
			description: "App type will create the configuration in namespace metadata.namespace",
			required: ["name", "namespace", "port", "username"],
			minimal_config: {
				format: "terraform",
				source: "_llms-txt/resources/cminstance.txt#minimal-valid-config",
			},
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_cminstance.example namespace/name",
		},
	],
} as const;
