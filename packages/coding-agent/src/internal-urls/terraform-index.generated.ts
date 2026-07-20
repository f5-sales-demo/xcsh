// AUTO-GENERATED — do not edit. Run `bun generate-terraform-index` to regenerate.

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
				"securemesh_site",
				"securemesh_site_v2",
				"site",
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
			name: "DNS",
			slug: "dns",
			description: "DNS domains, zones, compliance checks, and DNS proxy configuration",
			resource_count: 7,
			resources: [
				"dns_compliance_checks",
				"dns_domain",
				"dns_lb_health_check",
				"dns_lb_pool",
				"dns_load_balancer",
				"dns_proxy",
				"dns_zone",
			],
		},
		{
			name: "Uncategorized",
			slug: "uncategorized",
			description: "Resources pending categorization",
			resource_count: 6,
			resources: [
				"application_profiles",
				"authorization_server",
				"bot_infrastructure",
				"mitigated_domain",
				"protected_application",
				"protected_domain",
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
			name: "Monitoring",
			slug: "monitoring",
			description: "Log receivers, alert policies, APM, and global logging configuration",
			resource_count: 5,
			resources: ["alert_receiver", "alert_template", "apm", "global_log_receiver", "log_receiver"],
		},
		{
			name: "Applications",
			slug: "applications",
			description: "Application settings, types, discovery, and filtering",
			resource_count: 4,
			resources: ["app_setting", "app_type", "discovery", "filter_set"],
		},
		{
			name: "Certificates",
			slug: "certificates",
			description: "TLS certificates, certificate chains, CRLs, and trusted CA lists",
			resource_count: 4,
			resources: ["certificate", "certificate_chain", "crl", "trusted_ca_list"],
		},
		{
			name: "VPN",
			slug: "vpn",
			description: "VPN and IPSec configuration",
			resource_count: 4,
			resources: ["ike1", "ike2", "ike_phase1_profile", "ike_phase2_profile"],
		},
		{
			name: "Authentication",
			slug: "authentication",
			description: "Authentication methods, cloud credentials, and secret management",
			resource_count: 3,
			resources: ["authentication", "cloud_credentials", "secret_management_access"],
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
	resources: {
		address_allocator: {
			category: "cloud-resources",
			description: "Address Allocator will create an address allocator object in 'system' namespace of the user",
			required: ["name", "namespace", "mode"],
			minimal_config:
				'resource "xcsh_address_allocator" "example" {\n  name      = "example-address-allocator"\n  namespace = "staging"\n\n  address_pool = ["example-value"]\n  mode         = "LOCAL"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_address_allocator.example namespace/name",
		},
		advertise_policy: {
			category: "load-balancing",
			description:
				"Advertise_policy object controls how and where a service represented by a given virtual_host object is advertised to consumers. configuration",
			required: ["name", "namespace", "address", "protocol", "skip_xff_append"],
			minimal_config:
				'resource "xcsh_advertise_policy" "example" {\n  name      = "example-advertise-policy"\n  namespace = "staging"\n\n  address         = "example-value"\n  protocol        = "example-value"\n  skip_xff_append = true\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_advertise_policy.example namespace/name",
		},
		alert_gen_policy: {
			category: "security",
			description: "Alert Generation Policy",
			required: ["name", "namespace", "alert_status"],
			minimal_config:
				'resource "xcsh_alert_gen_policy" "example" {\n  name      = "example-alert-gen-policy"\n  namespace = "staging"\n\n  alert_status = "ALERT_ACTIVE"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_alert_gen_policy.example namespace/name",
		},
		alert_policy: {
			category: "security",
			description: "New Alert Policy Object",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_alert_policy" "example" {\n  name      = "example-alert-policy"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_alert_policy.example namespace/name",
		},
		alert_receiver: {
			category: "monitoring",
			description: "New Alert Receiver object",
			required: ["name", "namespace", "receiver_choice"],
			minimal_config:
				'resource "xcsh_alert_receiver" "example" {\n  name      = "example-alert-receiver"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_alert_receiver.example namespace/name",
		},
		alert_template: {
			category: "monitoring",
			description: "Domain to protect",
			required: ["name", "namespace", "alert_message", "alert_message_details", "alert_name", "severity"],
			minimal_config:
				'resource "xcsh_alert_template" "example" {\n  name      = "example-alert-template"\n  namespace = "staging"\n\n  alert_message         = "example-value"\n  alert_message_details = "example-value"\n  alert_name            = "example-value"\n  severity              = "MINOR"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_alert_template.example namespace/name",
		},
		allowed_domain: {
			category: "organization",
			description: "Allowed domain",
			required: ["name", "namespace", "allowed_domain"],
			minimal_config:
				'resource "xcsh_allowed_domain" "example" {\n  name      = "example-allowed-domain"\n  namespace = "staging"\n\n  allowed_domain = "example-value"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_allowed_domain.example namespace/name",
		},
		api_crawler: {
			category: "api-security",
			description: "API Crawler resource",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_api_crawler" "example" {\n  name      = "example-api-crawler"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_api_crawler.example namespace/name",
		},
		api_definition: {
			category: "api-security",
			description: "API Definition",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_api_definition" "example" {\n  name      = "example-api-definition"\n  namespace = "staging"\n}',
			dependencies: {
				requires: ["namespace"],
			},
			import_syntax: "terraform import xcsh_api_definition.example namespace/name",
		},
		api_discovery: {
			category: "api-security",
			description: "API discovery creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace", "user_defined_api_discovery_policy"],
			minimal_config:
				'resource "xcsh_api_discovery" "example" {\n  name      = "example-api-discovery"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_api_discovery.example namespace/name",
		},
		api_testing: {
			category: "api-security",
			description: "API Testing resource",
			required: ["name", "namespace", "custom_header_value"],
			minimal_config:
				'resource "xcsh_api_testing" "example" {\n  name      = "example-api-testing"\n  namespace = "staging"\n\n  custom_header_value = "example-value"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_api_testing.example namespace/name",
		},
		apm: {
			category: "monitoring",
			description: "New APM as a service with configured parameters",
			required: ["name", "namespace"],
			minimal_config: 'resource "xcsh_apm" "example" {\n  name      = "example-apm"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_apm.example namespace/name",
		},
		app_api_group: {
			category: "api-security",
			description: "App_api_group creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_app_api_group" "example" {\n  name      = "example-app-api-group"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_app_api_group.example namespace/name",
		},
		app_firewall: {
			category: "security",
			description: "Application Firewall",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_app_firewall" "example" {\n  name      = "example-app-firewall"\n  namespace = "staging"\n}',
			dependencies: {
				requires: ["namespace"],
			},
			import_syntax: "terraform import xcsh_app_firewall.example namespace/name",
		},
		app_setting: {
			category: "applications",
			description: "App setting configuration in namespace metadata.namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_app_setting" "example" {\n  name      = "example-app-setting"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_app_setting.example namespace/name",
		},
		app_type: {
			category: "applications",
			description: "App type will create the configuration in namespace metadata.namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_app_type" "example" {\n  name      = "example-app-type"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_app_type.example namespace/name",
		},
		application_profiles: {
			category: "uncategorized",
			description: "Application Profiles in a given namespace. If one already exists it will give an error",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_application_profiles" "example" {\n  name      = "example-application-profiles"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_application_profiles.example namespace/name",
		},
		authentication: {
			category: "authentication",
			description: "Authentication resource",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_authentication" "example" {\n  name      = "example-authentication"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_authentication.example namespace/name",
		},
		authorization_server: {
			category: "uncategorized",
			description: "Authorization_server creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace", "jwks_uri"],
			minimal_config:
				'resource "xcsh_authorization_server" "example" {\n  name      = "example-authorization-server"\n  namespace = "staging"\n\n  jwks_uri = "example-value"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_authorization_server.example namespace/name",
		},
		aws_tgw_site: {
			category: "sites",
			description: "Deploying F5 sites connected via AWS Transit Gateway",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_aws_tgw_site" "example" {\n  name      = "example-aws-tgw-site"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_aws_tgw_site.example namespace/name",
		},
		aws_vpc_site: {
			category: "sites",
			description: "Deploying F5 sites within AWS VPC environments",
			required: ["name", "namespace", "address", "aws_region", "disk_size", "instance_type", "ssh_key"],
			minimal_config:
				'resource "xcsh_aws_vpc_site" "example" {\n  name      = "example-aws-vpc-site"\n  namespace = "staging"\n\n  aws_region    = "example-value"\n  instance_type = "example-value"\n  ssh_key       = "example-value"\n  address       = "example-value"\n  disk_size     = 1\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_aws_vpc_site.example namespace/name",
		},
		azure_vnet_site: {
			category: "sites",
			description: "Deploying F5 sites within Azure Virtual Network environments",
			required: ["name", "namespace", "machine_type", "resource_group", "ssh_key"],
			minimal_config:
				'resource "xcsh_azure_vnet_site" "example" {\n  name      = "example-Azure-vnet-site"\n  namespace = "staging"\n\n  machine_type   = "example-value"\n  resource_group = "example-value"\n  ssh_key        = "example-value"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_azure_vnet_site.example namespace/name",
		},
		bgp: {
			category: "networking",
			description:
				"Bgp object is the configuration for peering with external bgp servers. it is created by users in system namespace. configuration",
			required: ["name", "namespace"],
			minimal_config: 'resource "xcsh_bgp" "example" {\n  name      = "example-bgp"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_bgp.example namespace/name",
		},
		bgp_asn_set: {
			category: "networking",
			description: "Bgp_asn_set creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_bgp_asn_set" "example" {\n  name      = "example-bgp-asn-set"\n  namespace = "staging"\n\n  as_numbers = [1]\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_bgp_asn_set.example namespace/name",
		},
		bgp_routing_policy: {
			category: "security",
			description:
				"Bgp routing policy is a list of rules containing match criteria and action to be applied. these rules help contol routes which are imported or exported to bgp peers. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_bgp_routing_policy" "example" {\n  name      = "example-bgp-routing-policy"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_bgp_routing_policy.example namespace/name",
		},
		bigip_http_proxy: {
			category: "big-ip-integration",
			description: "BIG-IP HTTP Proxy in a given namespace. If one already exists, it will give an error",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_bigip_http_proxy" "example" {\n  name      = "example-bigip-http-proxy"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_bigip_http_proxy.example namespace/name",
		},
		bot_defense_app_infrastructure: {
			category: "security",
			description: "Bot Defense App Infrastructure in a given namespace",
			required: ["name", "namespace", "environment_type", "traffic_type"],
			minimal_config:
				'resource "xcsh_bot_defense_app_infrastructure" "example" {\n  name      = "example-bot-defense-app-infrastructure"\n  namespace = "staging"\n\n  environment_type = "PRODUCTION"\n  traffic_type     = "WEB"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_bot_defense_app_infrastructure.example namespace/name",
		},
		bot_infrastructure: {
			category: "uncategorized",
			description: "Bot Infrastructure",
			required: ["name", "namespace", "traffic_type"],
			minimal_config:
				'resource "xcsh_bot_infrastructure" "example" {\n  name      = "example-bot-infrastructure"\n  namespace = "staging"\n\n  traffic_type = "WEB"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_bot_infrastructure.example namespace/name",
		},
		cdn_cache_rule: {
			category: "load-balancing",
			description: "CDN loadbalancer specification. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_cdn_cache_rule" "example" {\n  name      = "example-CDN-cache-rule"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_cdn_cache_rule.example namespace/name",
		},
		cdn_loadbalancer: {
			category: "load-balancing",
			description: "Content delivery and edge caching with load balancing",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_cdn_loadbalancer" "example" {\n  name      = "example-CDN-loadbalancer"\n  namespace = "staging"\n\n  domains = ["example-value"]\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_cdn_loadbalancer.example namespace/name",
		},
		cdn_purge_command: {
			category: "load-balancing",
			description: "CDN purge command specification. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_cdn_purge_command" "example" {\n  name      = "example-CDN-purge-command"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_cdn_purge_command.example namespace/name",
		},
		certificate: {
			category: "certificates",
			description: "Certificate. configuration",
			required: ["name", "namespace", "certificate_url", "private_key"],
			minimal_config:
				'resource "xcsh_certificate" "example" {\n  name      = "example-certificate"\n  namespace = "staging"\n\n  certificate_url = "example-value"\n}',
			dependencies: {
				requires: ["namespace"],
			},
			import_syntax: "terraform import xcsh_certificate.example namespace/name",
		},
		certificate_chain: {
			category: "certificates",
			description: "Certificate chain configuration for TLS",
			required: ["name", "namespace", "certificate_url"],
			minimal_config:
				'resource "xcsh_certificate_chain" "example" {\n  name      = "example-certificate-chain"\n  namespace = "staging"\n\n  certificate_url = "example-value"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_certificate_chain.example namespace/name",
		},
		cloud_connect: {
			category: "networking",
			description: "Establishing connectivity to cloud provider networks",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_cloud_connect" "example" {\n  name      = "example-cloud-connect"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_cloud_connect.example namespace/name",
		},
		cloud_credentials: {
			category: "authentication",
			description: "Api to create cloud_credentials object. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_cloud_credentials" "example" {\n  name      = "example-cloud-credentials"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_cloud_credentials.example namespace/name",
		},
		cloud_elastic_ip: {
			category: "cloud-resources",
			description: "Cloud Elastic IP creates Cloud Elastic IP object Object is attached to a site",
			required: ["name", "namespace", "item_count"],
			minimal_config:
				'resource "xcsh_cloud_elastic_ip" "example" {\n  name      = "example-cloud-elastic-ip"\n  namespace = "staging"\n\n  item_count = 1\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_cloud_elastic_ip.example namespace/name",
		},
		cloud_link: {
			category: "networking",
			description: "New CloudLink with configured parameters",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_cloud_link" "example" {\n  name      = "example-cloud-link"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_cloud_link.example namespace/name",
		},
		cluster: {
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
			minimal_config:
				'resource "xcsh_cluster" "example" {\n  name      = "example-cluster"\n  namespace = "staging"\n\n  connection_timeout     = 1\n  endpoint_selection     = "DISTRIBUTED"\n  fallback_policy        = "NO_FALLBACK"\n  http_idle_timeout      = 1\n  loadbalancer_algorithm = "ROUND_ROBIN"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_cluster.example namespace/name",
		},
		cminstance: {
			category: "subscriptions",
			description: "App type will create the configuration in namespace metadata.namespace",
			required: ["name", "namespace", "port", "username"],
			minimal_config:
				'resource "xcsh_cminstance" "example" {\n  name      = "example-cminstance"\n  namespace = "staging"\n\n  port     = 1\n  username = "example-value"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_cminstance.example namespace/name",
		},
		code_base_integration: {
			category: "integrations",
			description: "Integration details",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_code_base_integration" "example" {\n  name      = "example-code-base-integration"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_code_base_integration.example namespace/name",
		},
		container_registry: {
			category: "kubernetes",
			description: "Container image registry configuration",
			required: ["name", "namespace", "email", "registry", "user_name"],
			minimal_config:
				'resource "xcsh_container_registry" "example" {\n  name      = "example-container-registry"\n  namespace = "staging"\n\n  registry  = "example-value"\n  user_name = "example-value"\n  email     = "example-value"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_container_registry.example namespace/name",
		},
		crl: {
			category: "certificates",
			description: "Api to create crl object. configuration",
			required: ["name", "namespace", "refresh_interval", "server_address", "server_port", "timeout"],
			minimal_config:
				'resource "xcsh_crl" "example" {\n  name      = "example-crl"\n  namespace = "staging"\n\n  refresh_interval = 1\n  server_address   = "example-value"\n  server_port      = 1\n  timeout          = 1\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_crl.example namespace/name",
		},
		data_group: {
			category: "big-ip-integration",
			description: "Data group in a given namespace. If one already exists it will give an error",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_data_group" "example" {\n  name      = "example-data-group"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_data_group.example namespace/name",
		},
		data_type: {
			category: "security",
			description: "Data_type creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace", "is_pii", "is_sensitive_data"],
			minimal_config:
				'resource "xcsh_data_type" "example" {\n  name      = "example-data-type"\n  namespace = "staging"\n\n  compliances       = ["example-value"]\n  is_pii            = true\n  is_sensitive_data = true\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_data_type.example namespace/name",
		},
		dc_cluster_group: {
			category: "networking",
			description: "DC Cluster group in given namespace",
			required: ["name"],
			minimal_config:
				'resource "xcsh_dc_cluster_group" "example" {\n  name      = "example-dc-cluster-group"\n  namespace = "system"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_dc_cluster_group.example namespace/name",
		},
		discovery: {
			category: "applications",
			description: "Api to create discovery object for a site or virtual site in system namespace. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_discovery" "example" {\n  name      = "example-discovery"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_discovery.example namespace/name",
		},
		dns_compliance_checks: {
			category: "dns",
			description:
				"DNS Compliance Checks Specification in a given namespace. If one already exists it will give an error",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_dns_compliance_checks" "example" {\n  name      = "example-dns-compliance-checks"\n  namespace = "staging"\n\n  domain_denylist                      = ["example-value"]\n  disallowed_query_type_list           = ["example-value"]\n  disallowed_resource_record_type_list = ["example-value"]\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_dns_compliance_checks.example namespace/name",
		},
		dns_domain: {
			category: "dns",
			description: "DNS Domain in a given namespace. If one already exist it will give a error",
			required: ["name", "dnssec_mode"],
			minimal_config:
				'resource "xcsh_dns_domain" "example" {\n  name      = "example-dns-domain"\n  namespace = "system"\n\n  dnssec_mode = "DNSSEC_DISABLE"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_dns_domain.example namespace/name",
		},
		dns_lb_health_check: {
			category: "dns",
			description: "DNS Load Balancer Health Check in a given namespace. If one already exist it will give a error",
			required: ["name"],
			minimal_config:
				'resource "xcsh_dns_lb_health_check" "example" {\n  name      = "example-dns-lb-health-check"\n  namespace = "system"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_dns_lb_health_check.example namespace/name",
		},
		dns_lb_pool: {
			category: "dns",
			description: "DNS Load Balancer Pool in a given namespace. If one already exist it will give a error",
			required: ["name", "load_balancing_mode"],
			minimal_config:
				'resource "xcsh_dns_lb_pool" "example" {\n  name      = "example-dns-lb-pool"\n  namespace = "system"\n\n  load_balancing_mode = "ROUND_ROBIN"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_dns_lb_pool.example namespace/name",
		},
		dns_load_balancer: {
			category: "dns",
			description: "DNS Load Balancer in a given namespace. If one already exist it will give a error",
			required: ["name"],
			minimal_config:
				'resource "xcsh_dns_load_balancer" "example" {\n  name      = "example-dns-load-balancer"\n  namespace = "system"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_dns_load_balancer.example namespace/name",
		},
		dns_proxy: {
			category: "dns",
			description: "DNS Proxy in a given namespace. If one already exists it will give an error",
			required: ["name", "transport_type"],
			minimal_config:
				'resource "xcsh_dns_proxy" "example" {\n  name      = "example-dns-proxy"\n  namespace = "system"\n\n  transport_type = "UDP"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_dns_proxy.example namespace/name",
		},
		dns_zone: {
			category: "dns",
			description: "DNS Zone in a given namespace. If one already exist it will give a error",
			required: ["name"],
			minimal_config:
				'resource "xcsh_dns_zone" "example" {\n  name      = "example-dns-zone"\n  namespace = "system"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_dns_zone.example namespace/name",
		},
		endpoint: {
			category: "load-balancing",
			description: "Endpoint will create the object in the storage backend for namespace metadata.namespace",
			required: ["name", "namespace", "health_check_port", "port", "protocol"],
			minimal_config:
				'resource "xcsh_endpoint" "example" {\n  name      = "example-endpoint"\n  namespace = "staging"\n\n  health_check_port = 1\n  port              = 1\n  protocol          = "example-value"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_endpoint.example namespace/name",
		},
		enhanced_firewall_policy: {
			category: "security",
			description: "Enhanced firewall policy specification. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_enhanced_firewall_policy" "example" {\n  name      = "example-enhanced-firewall-policy"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_enhanced_firewall_policy.example namespace/name",
		},
		external_connector: {
			category: "networking",
			description: "External_connector configuration specification. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_external_connector" "example" {\n  name      = "example-external-connector"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_external_connector.example namespace/name",
		},
		fast_acl: {
			category: "security",
			description:
				"Object, object contains rules to protect site from denial of service It has destination{destination IP, destination port) and references to",
			required: ["name"],
			minimal_config:
				'resource "xcsh_fast_acl" "example" {\n  name      = "example-fast-acl"\n  namespace = "system"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_fast_acl.example namespace/name",
		},
		fast_acl_rule: {
			category: "security",
			description: "New Fast ACL rule, has specification to match source IP, source port and action to apply",
			required: ["name"],
			minimal_config:
				'resource "xcsh_fast_acl_rule" "example" {\n  name      = "example-fast-acl-rule"\n  namespace = "system"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_fast_acl_rule.example namespace/name",
		},
		filter_set: {
			category: "applications",
			description: "Specification",
			required: ["name", "namespace", "context_key"],
			minimal_config:
				'resource "xcsh_filter_set" "example" {\n  name      = "example-filter-set"\n  namespace = "staging"\n\n  context_key = "example-value"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_filter_set.example namespace/name",
		},
		fleet: {
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
			minimal_config:
				'resource "xcsh_fleet" "example" {\n  name      = "example-fleet"\n  namespace = "staging"\n\n  fleet_label                          = "example-value"\n  enable_default_fleet_config_download = true\n  operating_system_version             = "example-value"\n  volterra_software_version            = "example-value"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_fleet.example namespace/name",
		},
		forward_proxy_policy: {
			category: "security",
			description: "Forward proxy policy specification. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_forward_proxy_policy" "example" {\n  name      = "example-forward-proxy-policy"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_forward_proxy_policy.example namespace/name",
		},
		forwarding_class: {
			category: "networking",
			description: "Forwarding class is created by users in system namespace. configuration",
			required: ["name", "namespace", "queue_id_to_use", "interface_group"],
			minimal_config:
				'resource "xcsh_forwarding_class" "example" {\n  name      = "example-forwarding-class"\n  namespace = "staging"\n\n  interface_group = "ANY_AVAILABLE_INTERFACE"\n  queue_id_to_use = "DSCP_BEST_EFFORT"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_forwarding_class.example namespace/name",
		},
		gcp_vpc_site: {
			category: "sites",
			description: "Deploying F5 sites within Google Cloud VPC environments",
			required: ["name", "namespace", "address", "disk_size", "gcp_region", "instance_type", "ssh_key"],
			minimal_config:
				'resource "xcsh_gcp_vpc_site" "example" {\n  name      = "example-gcp-vpc-site"\n  namespace = "staging"\n\n  gcp_region    = "example-value"\n  instance_type = "example-value"\n  ssh_key       = "example-value"\n  address       = "example-value"\n  disk_size     = 1\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_gcp_vpc_site.example namespace/name",
		},
		geo_location_set: {
			category: "cloud-resources",
			description: "Geolocation Set",
			required: ["name"],
			minimal_config:
				'resource "xcsh_geo_location_set" "example" {\n  name      = "example-geo-location-set"\n  namespace = "system"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_geo_location_set.example namespace/name",
		},
		global_log_receiver: {
			category: "monitoring",
			description: "New Global Log Receiver object",
			required: ["name", "namespace", "log_type", "receiver_choice"],
			minimal_config:
				'resource "xcsh_global_log_receiver" "example" {\n  name      = "example-global-log-receiver"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_global_log_receiver.example namespace/name",
		},
		healthcheck: {
			category: "load-balancing",
			description:
				"Healthcheck object defines method to determine if the given endpoint is healthy. single healthcheck object can be referred to by one or many cluster objects. configuration",
			required: ["name", "namespace", "interval", "timeout", "healthy_threshold", "unhealthy_threshold"],
			server_defaults: ["jitter_percent", "use_http2"],
			minimal_config:
				'resource "xcsh_healthcheck" "example" {\n  name      = "example-healthcheck"\n  namespace = "staging"\n\n  healthy_threshold   = 1\n  interval            = 1\n  timeout             = 1\n  unhealthy_threshold = 1\n}',
			dependencies: {
				requires: ["namespace"],
				used_by: ["origin_pool"],
			},
			import_syntax: "terraform import xcsh_healthcheck.example namespace/name",
		},
		http_loadbalancer: {
			category: "load-balancing",
			description: "Load balancing HTTP/HTTPS traffic with advanced routing and security",
			required: ["name", "namespace", "domains"],
			server_defaults: ["connection_timeout", "http_idle_timeout"],
			minimal_config:
				'resource "xcsh_http_loadbalancer" "example" {\n  name      = "example-http-loadbalancer"\n  namespace = "staging"\n\n  domains = ["example-value"]\n}',
			dependencies: {
				requires: ["namespace", "origin_pool"],
				used_by: ["route"],
			},
			import_syntax: "terraform import xcsh_http_loadbalancer.example namespace/name",
		},
		ike1: {
			category: "vpn",
			description: "Ike phase1 profile specification. configuration",
			required: ["name", "namespace"],
			minimal_config: 'resource "xcsh_ike1" "example" {\n  name      = "example-ike1"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_ike1.example namespace/name",
		},
		ike2: {
			category: "vpn",
			description: "Ike phase2 profile specification. configuration",
			required: ["name", "namespace"],
			minimal_config: 'resource "xcsh_ike2" "example" {\n  name      = "example-ike2"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_ike2.example namespace/name",
		},
		ike_phase1_profile: {
			category: "vpn",
			description: "Ike phase1 profile specification. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_ike_phase1_profile" "example" {\n  name      = "example-ike-phase1-profile"\n  namespace = "staging"\n\n  authentication_algos = ["example-value"]\n  dh_group             = ["example-value"]\n  encryption_algos     = ["example-value"]\n  prf                  = ["example-value"]\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_ike_phase1_profile.example namespace/name",
		},
		ike_phase2_profile: {
			category: "vpn",
			description: "Ike phase2 profile specification. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_ike_phase2_profile" "example" {\n  name      = "example-ike-phase2-profile"\n  namespace = "staging"\n\n  authentication_algos = ["example-value"]\n  encryption_algos     = ["example-value"]\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_ike_phase2_profile.example namespace/name",
		},
		ip_prefix_set: {
			category: "networking",
			description: "Ip_prefix_set creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_ip_prefix_set" "example" {\n  name      = "example-ip-prefix-set"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_ip_prefix_set.example namespace/name",
		},
		irule: {
			category: "big-ip-integration",
			description: "IRule in a given namespace. If one already exists it will give an error",
			required: ["name", "namespace", "description", "description_spec", "irule"],
			minimal_config:
				'resource "xcsh_irule" "example" {\n  name      = "example-irule"\n  namespace = "staging"\n\n  description_spec = "example-value"\n  irule            = "example-value"\n  description      = "example-value"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_irule.example namespace/name",
		},
		k8s_cluster: {
			category: "kubernetes",
			description: "K8s_cluster will create the object in the storage backend for namespace metadata.namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_k8s_cluster" "example" {\n  name      = "example-k8s-cluster"\n  namespace = "system"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_k8s_cluster.example namespace/name",
		},
		k8s_cluster_role: {
			category: "kubernetes",
			description: "K8s_cluster_role will create the object in the storage backend for namespace metadata.namespace",
			required: ["name"],
			minimal_config:
				'resource "xcsh_k8s_cluster_role" "example" {\n  name      = "example-k8s-cluster-role"\n  namespace = "system"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_k8s_cluster_role.example namespace/name",
		},
		k8s_cluster_role_binding: {
			category: "kubernetes",
			description:
				"K8s_cluster_role_binding will create the object in the storage backend for namespace metadata.namespace",
			required: ["name"],
			minimal_config:
				'resource "xcsh_k8s_cluster_role_binding" "example" {\n  name      = "example-k8s-cluster-role-binding"\n  namespace = "system"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_k8s_cluster_role_binding.example namespace/name",
		},
		k8s_pod_security_admission: {
			category: "kubernetes",
			description: "K8s_pod_security_admission will create the object in the storage backend",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_k8s_pod_security_admission" "example" {\n  name      = "example-k8s-pod-security-admission"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_k8s_pod_security_admission.example namespace/name",
		},
		k8s_pod_security_policy: {
			category: "security",
			description:
				"K8s_pod_security_policy will create the object in the storage backend for namespace metadata.namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_k8s_pod_security_policy" "example" {\n  name      = "example-k8s-pod-security-policy"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_k8s_pod_security_policy.example namespace/name",
		},
		log_receiver: {
			category: "monitoring",
			description: "New Log Receiver object",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_log_receiver" "example" {\n  name      = "example-log-receiver"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_log_receiver.example namespace/name",
		},
		malicious_user_mitigation: {
			category: "security",
			description: "Malicious_user_mitigation creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_malicious_user_mitigation" "example" {\n  name      = "example-malicious-user-mitigation"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_malicious_user_mitigation.example namespace/name",
		},
		mitigated_domain: {
			category: "uncategorized",
			description: "Mitigated Domain",
			required: ["name", "namespace", "mitigated_domain"],
			minimal_config:
				'resource "xcsh_mitigated_domain" "example" {\n  name      = "example-mitigated-domain"\n  namespace = "staging"\n\n  mitigated_domain = "example-value"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_mitigated_domain.example namespace/name",
		},
		namespace: {
			category: "organization",
			description: "New namespace. Name of the object is name of the namespace",
			required: ["name"],
			minimal_config:
				'resource "xcsh_namespace" "example" {\n  name      = "example-namespace"\n  namespace = "staging"\n}',
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
		nat_policy: {
			category: "security",
			description: "Nat policy create specification configures nat policy with multiple rules,. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_nat_policy" "example" {\n  name      = "example-nat-policy"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_nat_policy.example namespace/name",
		},
		network_connector: {
			category: "networking",
			description: "Network connector is created by users in system namespace. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_network_connector" "example" {\n  name      = "example-network-connector"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_network_connector.example namespace/name",
		},
		network_firewall: {
			category: "security",
			description: "Network firewall is created by users in system namespace. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_network_firewall" "example" {\n  name      = "example-network-firewall"\n  namespace = "system"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_network_firewall.example namespace/name",
		},
		network_interface: {
			category: "networking",
			description:
				"Network interface represents configuration of a network device. it is created by users in system namespace. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_network_interface" "example" {\n  name      = "example-network-interface"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_network_interface.example namespace/name",
		},
		network_policy: {
			category: "security",
			description: "New network policy with configured parameters in specified namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_network_policy" "example" {\n  name      = "example-network-policy"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_network_policy.example namespace/name",
		},
		network_policy_rule: {
			category: "security",
			description: "Network policy rule with configured parameters in specified namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_network_policy_rule" "example" {\n  name      = "example-network-policy-rule"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_network_policy_rule.example namespace/name",
		},
		network_policy_view: {
			category: "security",
			description: "Network policy view specification. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_network_policy_view" "example" {\n  name      = "example-network-policy-view"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_network_policy_view.example namespace/name",
		},
		nfv_service: {
			category: "networking",
			description: "New NFV service with configured parameters",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_nfv_service" "example" {\n  name      = "example-nfv-service"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_nfv_service.example namespace/name",
		},
		nginx_service_discovery: {
			category: "networking",
			description:
				"Api to create nginx service discovery object for a site or virtual site in system namespace. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_nginx_service_discovery" "example" {\n  name      = "example-nginx-service-discovery"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_nginx_service_discovery.example namespace/name",
		},
		origin_pool: {
			category: "load-balancing",
			description: "Defining backend server pools for load balancer targets",
			required: ["name", "namespace", "origin_servers", "port"],
			server_defaults: ["connection_timeout", "http_idle_timeout"],
			minimal_config:
				'resource "xcsh_origin_pool" "example" {\n  name      = "example-origin-pool"\n  namespace = "staging"\n}',
			dependencies: {
				requires: ["namespace", "healthcheck"],
				used_by: ["http_loadbalancer", "tcp_loadbalancer", "udp_loadbalancer"],
			},
			import_syntax: "terraform import xcsh_origin_pool.example namespace/name",
		},
		policer: {
			category: "service-mesh",
			description: "New policer with traffic rate limits",
			required: ["name", "namespace", "burst_size", "committed_information_rate"],
			minimal_config:
				'resource "xcsh_policer" "example" {\n  name      = "example-policer"\n  namespace = "staging"\n\n  burst_size                 = 1\n  committed_information_rate = 1\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_policer.example namespace/name",
		},
		policy_based_routing: {
			category: "networking",
			description: "Network policy based routing create specification. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_policy_based_routing" "example" {\n  name      = "example-policy-based-routing"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_policy_based_routing.example namespace/name",
		},
		protected_application: {
			category: "uncategorized",
			description: "Applications protected by Bot Defense",
			required: ["name", "namespace", "region"],
			minimal_config:
				'resource "xcsh_protected_application" "example" {\n  name      = "example-protected-application"\n  namespace = "staging"\n\n  region = "US"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_protected_application.example namespace/name",
		},
		protected_domain: {
			category: "uncategorized",
			description: "Domain to protect",
			required: ["name", "namespace", "protected_domain"],
			minimal_config:
				'resource "xcsh_protected_domain" "example" {\n  name      = "example-protected-domain"\n  namespace = "staging"\n\n  protected_domain = "example-value"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_protected_domain.example namespace/name",
		},
		protocol_inspection: {
			category: "security",
			description:
				"Protocol Inspection Specification in a given namespace. If one already exists it will give an error",
			required: ["name", "namespace", "enable_disable_compliance_checks", "enable_disable_signatures"],
			minimal_config:
				'resource "xcsh_protocol_inspection" "example" {\n  name      = "example-protocol-inspection"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_protocol_inspection.example namespace/name",
		},
		protocol_policer: {
			category: "security",
			description:
				"Protocol_policer object, protocol_policer object contains list of L4 protocol match condition and corresponding traffic rate limits",
			required: ["name"],
			minimal_config:
				'resource "xcsh_protocol_policer" "example" {\n  name      = "example-protocol-policer"\n  namespace = "system"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_protocol_policer.example namespace/name",
		},
		proxy: {
			category: "networking",
			description: "Tcp loadbalancer create specification. configuration",
			required: ["name", "namespace", "connection_timeout"],
			minimal_config:
				'resource "xcsh_proxy" "example" {\n  name      = "example-proxy"\n  namespace = "staging"\n\n  connection_timeout = 1\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_proxy.example namespace/name",
		},
		rate_limiter: {
			category: "security",
			description: "Rate_limiter creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_rate_limiter" "example" {\n  name      = "example-rate-limiter"\n  namespace = "staging"\n}',
			dependencies: {
				requires: ["namespace"],
			},
			import_syntax: "terraform import xcsh_rate_limiter.example namespace/name",
		},
		rate_limiter_policy: {
			category: "security",
			description: "Rate limiter policy create specification. configuration",
			required: ["name", "namespace", "burst_size", "committed_information_rate"],
			minimal_config:
				'resource "xcsh_rate_limiter_policy" "example" {\n  name      = "example-rate-limiter-policy"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_rate_limiter_policy.example namespace/name",
		},
		route: {
			category: "load-balancing",
			description:
				"Route object in a given namespace. Route object is list of route rules. Each rule has match condition to match incoming requests and actions to take on matching requests",
			required: ["name", "namespace"],
			minimal_config: 'resource "xcsh_route" "example" {\n  name      = "example-route"\n  namespace = "staging"\n}',
			dependencies: {
				requires: ["namespace", "http_loadbalancer"],
			},
			import_syntax: "terraform import xcsh_route.example namespace/name",
		},
		secret_management_access: {
			category: "authentication",
			description: "Secret_management_access creates a new object in storage backend for metadata.namespace",
			required: ["name", "namespace", "provider_name"],
			minimal_config:
				'resource "xcsh_secret_management_access" "example" {\n  name      = "example-secret-management-access"\n  namespace = "staging"\n\n  provider_name = "example-value"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_secret_management_access.example namespace/name",
		},
		securemesh_site: {
			category: "sites",
			description: "Deploying secure mesh edge sites with distributed security capabilities",
			required: ["name", "namespace", "address", "volterra_certified_hw"],
			minimal_config:
				'resource "xcsh_securemesh_site" "example" {\n  name      = "example-securemesh-site"\n  namespace = "staging"\n\n  volterra_certified_hw = "example-value"\n  worker_nodes          = ["example-value"]\n  address               = "example-value"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_securemesh_site.example namespace/name",
		},
		securemesh_site_v2: {
			category: "sites",
			description: "Deploying secure mesh edge sites with enhanced security and networking features",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_securemesh_site_v2" "example" {\n  name      = "example-securemesh-site-v2"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_securemesh_site_v2.example namespace/name",
		},
		segment: {
			category: "networking",
			description: "Segment. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_segment" "example" {\n  name      = "example-segment"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_segment.example namespace/name",
		},
		sensitive_data_policy: {
			category: "security",
			description: "Sensitive_data_policy creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_sensitive_data_policy" "example" {\n  name      = "example-sensitive-data-policy"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_sensitive_data_policy.example namespace/name",
		},
		service_policy: {
			category: "security",
			description: "Service_policy creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_service_policy" "example" {\n  name      = "example-service-policy"\n  namespace = "staging"\n}',
			dependencies: {
				requires: ["namespace"],
			},
			import_syntax: "terraform import xcsh_service_policy.example namespace/name",
		},
		service_policy_rule: {
			category: "security",
			description: "Service_policy_rule creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_service_policy_rule" "example" {\n  name      = "example-service-policy-rule"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_service_policy_rule.example namespace/name",
		},
		site: {
			category: "sites",
			description: "Virtual site object in given namespace",
			required: ["name", "namespace", "site_type"],
			minimal_config:
				'resource "xcsh_site" "example" {\n  name      = "example-site"\n  namespace = "staging"\n\n  site_type = "INVALID"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_site.example namespace/name",
		},
		site_mesh_group: {
			category: "sites",
			description: "Site Mesh Group in system namespace of user",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_site_mesh_group" "example" {\n  name      = "example-site-mesh-group"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_site_mesh_group.example namespace/name",
		},
		srv6_network_slice: {
			category: "networking",
			description: "Srv6_network_slice creates a new object in the storage backend for metadata.namespace",
			required: [
				"name",
				"namespace",
				"connect_to_access_networks",
				"connect_to_enterprise_networks",
				"connect_to_internet",
			],
			minimal_config:
				'resource "xcsh_srv6_network_slice" "example" {\n  name      = "example-srv6-network-slice"\n  namespace = "staging"\n\n  sid_prefixes                   = ["example-value"]\n  connect_to_access_networks     = true\n  connect_to_enterprise_networks = true\n  connect_to_internet            = true\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_srv6_network_slice.example namespace/name",
		},
		subnet: {
			category: "networking",
			description:
				"Subnet object contains configuration for an interface of a vm/pod. it is created in user or shared namespace. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_subnet" "example" {\n  name      = "example-subnet"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_subnet.example namespace/name",
		},
		tcp_loadbalancer: {
			category: "load-balancing",
			description: "Load balancing TCP traffic across origin pools",
			required: ["name", "namespace", "origin_pools"],
			minimal_config:
				'resource "xcsh_tcp_loadbalancer" "example" {\n  name      = "example-tcp-loadbalancer"\n  namespace = "staging"\n}',
			dependencies: {
				requires: ["namespace", "origin_pool"],
			},
			import_syntax: "terraform import xcsh_tcp_loadbalancer.example namespace/name",
		},
		tenant_configuration: {
			category: "organization",
			description: "Tenant configuration specification. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_tenant_configuration" "example" {\n  name      = "example-tenant-configuration"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_tenant_configuration.example namespace/name",
		},
		trusted_ca_list: {
			category: "certificates",
			description: "Trusted certificate authority list management",
			required: ["name", "namespace", "trusted_ca_url"],
			minimal_config:
				'resource "xcsh_trusted_ca_list" "example" {\n  name      = "example-trusted-ca-list"\n  namespace = "staging"\n\n  trusted_ca_url = "example-value"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_trusted_ca_list.example namespace/name",
		},
		tunnel: {
			category: "networking",
			description: "Tunnel in a given namespace. If one already exist it will give a error",
			required: ["name", "namespace", "tunnel_type"],
			minimal_config:
				'resource "xcsh_tunnel" "example" {\n  name      = "example-tunnel"\n  namespace = "staging"\n\n  tunnel_type = "IPSEC_PSK"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_tunnel.example namespace/name",
		},
		udp_loadbalancer: {
			category: "load-balancing",
			description: "Load balancing UDP traffic across origin pools",
			required: ["name", "namespace", "dns_volterra_managed", "enable_per_packet_load_balancing", "idle_timeout"],
			minimal_config:
				'resource "xcsh_udp_loadbalancer" "example" {\n  name      = "example-udp-loadbalancer"\n  namespace = "staging"\n\n  domains                          = ["example-value"]\n  dns_volterra_managed             = true\n  enable_per_packet_load_balancing = true\n  idle_timeout                     = 1\n}',
			dependencies: {
				requires: ["namespace", "origin_pool"],
			},
			import_syntax: "terraform import xcsh_udp_loadbalancer.example namespace/name",
		},
		usb_policy: {
			category: "security",
			description: "New USB policy object",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_usb_policy" "example" {\n  name      = "example-usb-policy"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_usb_policy.example namespace/name",
		},
		user_identification: {
			category: "security",
			description: "User_identification creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace", "rules"],
			minimal_config:
				'resource "xcsh_user_identification" "example" {\n  name      = "example-user-identification"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_user_identification.example namespace/name",
		},
		virtual_host: {
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
			minimal_config:
				'resource "xcsh_virtual_host" "example" {\n  name      = "example-virtual-host"\n  namespace = "staging"\n\n  domains                     = ["example-value"]\n  request_cookies_to_remove   = ["example-value"]\n  request_headers_to_remove   = ["example-value"]\n  response_cookies_to_remove  = ["example-value"]\n  response_headers_to_remove  = ["example-value"]\n  add_location                = true\n  connection_idle_timeout     = 1\n  disable_default_error_pages = true\n  disable_dns_resolve         = true\n  idle_timeout                = 1\n  max_request_header_size     = 1\n  proxy                       = "UDP_PROXY"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_virtual_host.example namespace/name",
		},
		virtual_k8s: {
			category: "kubernetes",
			description: "Virtual_k8s will create the object in the storage backend for namespace metadata.namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_virtual_k8s" "example" {\n  name      = "example-virtual-k8s"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_virtual_k8s.example namespace/name",
		},
		virtual_network: {
			category: "networking",
			description: "Virtual network in given namespace",
			required: ["name", "legacy_type"],
			minimal_config:
				'resource "xcsh_virtual_network" "example" {\n  name      = "example-virtual-network"\n  namespace = "system"\n\n  legacy_type = "VIRTUAL_NETWORK_SITE_LOCAL"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_virtual_network.example namespace/name",
		},
		virtual_site: {
			category: "sites",
			description: "Virtual site object in given namespace",
			required: ["name", "namespace", "site_type", "site_selector"],
			minimal_config:
				'resource "xcsh_virtual_site" "example" {\n  name      = "example-virtual-site"\n  namespace = "staging"\n\n  site_type = "INVALID"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_virtual_site.example namespace/name",
		},
		voltstack_site: {
			category: "sites",
			description: "Deploying Volterra stack sites for edge computing",
			required: ["name", "namespace", "address", "volterra_certified_hw"],
			minimal_config:
				'resource "xcsh_voltstack_site" "example" {\n  name      = "example-voltstack-site"\n  namespace = "staging"\n\n  volterra_certified_hw = "example-value"\n  worker_nodes          = ["example-value"]\n  address               = "example-value"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_voltstack_site.example namespace/name",
		},
		waf_exclusion_policy: {
			category: "security",
			description: "WAF exclusion policy",
			required: ["name", "namespace", "waf_exclusion_rules"],
			minimal_config:
				'resource "xcsh_waf_exclusion_policy" "example" {\n  name      = "example-waf-exclusion-policy"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_waf_exclusion_policy.example namespace/name",
		},
		workload: {
			category: "kubernetes",
			description: "Workload. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "xcsh_workload" "example" {\n  name      = "example-workload"\n  namespace = "staging"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_workload.example namespace/name",
		},
		workload_flavor: {
			category: "kubernetes",
			description: "Workload_flavor",
			required: ["name", "namespace", "ephemeral_storage", "memory", "vcpus"],
			minimal_config:
				'resource "xcsh_workload_flavor" "example" {\n  name      = "example-workload-flavor"\n  namespace = "staging"\n\n  ephemeral_storage = "example-value"\n  memory            = "example-value"\n  vcpus             = 1\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import xcsh_workload_flavor.example namespace/name",
		},
	},
} as const;
