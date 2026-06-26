// AUTO-GENERATED — do not edit. Run `bun generate-terraform-index` to regenerate.

import type { TerraformIndex } from "./terraform-types";

export const TERRAFORM_INDEX: TerraformIndex = {
	version: "0.1.0",
	provider: {
		source: "f5-sales-demo/f5xc",
		registry: "https://registry.terraform.io/providers/f5-sales-demo/f5xc",
		required_block:
			'terraform {\n  required_providers {\n    f5xc = {\n      source = "f5-sales-demo/f5xc"\n    }\n  }\n}',
		config_block: 'provider "f5xc" {}',
		auth_methods: [
			'REQUIRED: every .tf must contain a `provider "f5xc" {}` block. Without it Terraform errors: "Provider requires explicit configuration. Add a provider block".',
			"Configure exactly ONE auth method, via environment variables (preferred) or explicit arguments in the provider block:",
			"api_token (env F5XC_API_TOKEN) — API token authentication.",
			"api_p12_file + p12_password (env F5XC_P12_FILE + F5XC_P12_PASSWORD) — PKCS#12 certificate authentication.",
			"api_cert + api_key (env F5XC_CERT + F5XC_KEY) — PEM certificate authentication.",
			"api_url (env F5XC_API_URL) — tenant base URL without /api suffix, e.g. https://your-tenant.console.ves.volterra.io.",
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
			resource_count: 26,
			resources: [
				"app_firewall",
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
			name: "Certificates",
			slug: "certificates",
			description: "TLS certificates, certificate chains, CRLs, and trusted CA lists",
			resource_count: 4,
			resources: ["certificate", "certificate_chain", "crl", "trusted_ca_list"],
		},
		{
			name: "Monitoring",
			slug: "monitoring",
			description: "Log receivers, alert policies, APM, and global logging configuration",
			resource_count: 4,
			resources: ["alert_receiver", "apm", "global_log_receiver", "log_receiver"],
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
			name: "DNS",
			slug: "dns",
			description: "DNS domains, zones, compliance checks, and DNS proxy configuration",
			resource_count: 3,
			resources: ["dns_compliance_checks", "dns_domain", "dns_proxy"],
		},
		{
			name: "Cloud Resources",
			slug: "cloud-resources",
			description: "Cloud elastic IPs, address allocators, and geo-location resources",
			resource_count: 2,
			resources: ["address_allocator", "cloud_elastic_ip"],
		},
		{
			name: "Organization",
			slug: "organization",
			description: "Namespaces, tenant configuration, and organizational settings",
			resource_count: 2,
			resources: ["namespace", "tenant_configuration"],
		},
		{
			name: "Uncategorized",
			slug: "uncategorized",
			description: "Resources pending categorization",
			resource_count: 2,
			resources: ["application_profiles", "authorization_server"],
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
				'resource "f5xc_address_allocator" "example" {\n  name      = "example-address-allocator"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  address_allocation_scheme {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_address_allocator.example namespace/name",
		},
		advertise_policy: {
			category: "load-balancing",
			description:
				"Advertise_policy object controls how and where a service represented by a given virtual_host object is advertised to consumers. configuration",
			required: ["name", "namespace", "address", "protocol", "skip_xff_append"],
			minimal_config:
				'resource "f5xc_advertise_policy" "example" {\n  name      = "example-advertise-policy"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  public_ip {\n  }\n  tls_parameters {\n  }\n  client_certificate_optional {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_advertise_policy.example namespace/name",
		},
		alert_policy: {
			category: "security",
			description: "New Alert Policy Object",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_alert_policy" "example" {\n  name      = "example-alert-policy"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  receivers {\n    name      = "slack-receiver"\n    namespace = "staging"\n  }\n\n  routes {\n    any {}\n    send {}\n  }\n\n  notification_parameters {\n    default {}\n    group_wait     = "30s"\n    group_interval = "1m"\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_alert_policy.example namespace/name",
		},
		alert_receiver: {
			category: "monitoring",
			description: "New Alert Receiver object",
			required: ["name", "namespace", "receiver_choice"],
			minimal_config:
				'resource "f5xc_alert_receiver" "example" {\n  name      = "example-alert-receiver"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  slack {\n    url = "`https://your-slack-webhook-url"`\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_alert_receiver.example namespace/name",
		},
		api_crawler: {
			category: "api-security",
			description: "API Crawler resource",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_api_crawler" "example" {\n  name      = "example-api-crawler"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  domains {\n  }\n  simple_login {\n  }\n  password {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_api_crawler.example namespace/name",
		},
		api_definition: {
			category: "api-security",
			description: "API Definition",
			required: ["name", "namespace"],
			server_defaults: [
				"swagger_specs",
				"api_inventory_exclusion_list",
				"api_inventory_inclusion_list",
				"non_api_endpoints",
				"strict_schema_origin",
			],
			minimal_config:
				'resource "f5xc_api_definition" "example" {\n  name      = "example-api-definition"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  swagger_specs = ["string:///base64-openapi-spec"]\n\n  non_validation_mode {}\n}',
			dependencies: {
				requires: ["namespace"],
			},
			import_syntax: "terraform import f5xc_api_definition.example namespace/name",
		},
		api_discovery: {
			category: "api-security",
			description: "API discovery creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace", "user_defined_api_discovery_policy"],
			server_defaults: ["custom_auth_types"],
			minimal_config:
				'resource "f5xc_api_discovery" "example" {\n  name      = "example-api-discovery"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  custom_auth_types {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_api_discovery.example namespace/name",
		},
		api_testing: {
			category: "api-security",
			description: "API Testing resource",
			required: ["name", "namespace", "custom_header_value"],
			minimal_config:
				'resource "f5xc_api_testing" "example" {\n  name      = "example-api-testing"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  domains {\n  }\n  credentials {\n  }\n  admin {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_api_testing.example namespace/name",
		},
		apm: {
			category: "monitoring",
			description: "New APM as a service with configured parameters",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_apm" "example" {\n  name      = "example-apm"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  aws_site_type_choice {\n  }\n  apm_aws_site {\n  }\n  admin_password {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_apm.example namespace/name",
		},
		app_api_group: {
			category: "api-security",
			description: "App_api_group creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_app_api_group" "example" {\n  name      = "example-app-api-group"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  elements {\n  }\n  bigip_virtual_server {\n  }\n  cdn_loadbalancer {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_app_api_group.example namespace/name",
		},
		app_firewall: {
			category: "security",
			description: "Application Firewall",
			required: ["name", "namespace"],
			oneof_groups: [
				{
					fields: ["blocking", "monitoring"],
				},
				{
					fields: ["blocking_page", "use_default_blocking_page"],
				},
				{
					fields: ["bot_protection_setting", "default_bot_setting"],
				},
				{
					fields: ["ai_risk_based_blocking", "default_detection_settings", "detection_settings"],
				},
				{
					fields: ["allow_all_response_codes", "allowed_response_codes"],
				},
			],
			server_defaults: [
				"allow_all_response_codes",
				"default_anonymization",
				"default_detection_settings",
				"disable_ai_enhancements",
				"monitoring",
				"use_default_blocking_page",
			],
			minimal_config:
				'resource "f5xc_app_firewall" "example" {\n  name      = "example-app-firewall"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  // One of the arguments from this list "blocking monitoring" must be set\n\n  blocking {}\n\n  // One of the arguments from this list "blocking_page use_default_blocking_page" must be set\n\n  use_default_blocking_page {}\n\n  // One of the arguments from this list "bot_protection_setting default_bot_setting" must be set\n\n  bot_protection_setting {\n    malicious_bot_action  = "BLOCK"\n    suspicious_bot_action = "REPORT"\n    good_bot_action       = "REPORT"\n  }\n\n  // One of the arguments from this list "ai_risk_based_blocking default_detection_settings detection_settings" must be set\n\n  default_detection_settings {}\n\n  // One of the arguments from this list "allow_all_response_codes allowed_response_codes" must be set\n\n  allow_all_response_codes {}\n}',
			dependencies: {
				requires: ["namespace"],
			},
			import_syntax: "terraform import f5xc_app_firewall.example namespace/name",
		},
		app_setting: {
			category: "applications",
			description: "App setting configuration in namespace metadata.namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_app_setting" "example" {\n  name      = "example-app-setting"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  app_type_settings {\n  }\n  app_type_ref {\n  }\n  business_logic_markup_setting {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_app_setting.example namespace/name",
		},
		app_type: {
			category: "applications",
			description: "App type will create the configuration in namespace metadata.namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_app_type" "example" {\n  name      = "example-app-type"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  business_logic_markup_setting {\n  }\n  disable_spec {\n  }\n  discovered_api_settings {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_app_type.example namespace/name",
		},
		application_profiles: {
			category: "uncategorized",
			description: "Application Profiles in a given namespace. If one already exists it will give an error",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_application_profiles" "example" {\n  name      = "example-application-profiles"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  advanced_tcp_profile {\n  }\n  disable_tcp_advanced_profile {\n  }\n  enable_tcp_advanced_profile {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_application_profiles.example namespace/name",
		},
		authentication: {
			category: "authentication",
			description: "Authentication resource",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_authentication" "example" {\n  name      = "example-authentication"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  cookie_params {\n  }\n  auth_hmac {\n  }\n  prim_key {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_authentication.example namespace/name",
		},
		authorization_server: {
			category: "uncategorized",
			description: "Authorization_server creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace", "jwks_uri"],
			minimal_config:
				'resource "f5xc_authorization_server" "example" {\n  name      = "example-authorization-server"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_authorization_server.example namespace/name",
		},
		aws_tgw_site: {
			category: "sites",
			description: "Deploying F5 sites connected via AWS Transit Gateway",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_aws_tgw_site" "example" {\n  name      = "example-aws-tgw-site"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  aws_region = "us-west-2"\n\n  aws_cred {\n    name      = "aws-credentials"\n    namespace = "staging"\n  }\n\n  vpc {\n    new_vpc {\n      name_tag     = "f5xc-tgw-vpc"\n      primary_ipv4 = "10.0.0.0/16"\n    }\n  }\n\n  tgw {\n    new_tgw {\n      name = "f5xc-tgw"\n    }\n  }\n\n  instance_type = "t3.xlarge"\n\n  services_vpc {\n    aws_certified_hw = "aws-byol-voltmesh"\n    az_nodes {\n      aws_az_name = "us-west-2a"\n      inside_subnet {\n        subnet_param {\n          ipv4 = "10.0.1.0/24"\n        }\n      }\n      outside_subnet {\n        subnet_param {\n          ipv4 = "10.0.2.0/24"\n        }\n      }\n      workload_subnet {\n        subnet_param {\n          ipv4 = "10.0.3.0/24"\n        }\n      }\n    }\n  }\n\n  no_worker_nodes {}\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_aws_tgw_site.example namespace/name",
		},
		aws_vpc_site: {
			category: "sites",
			description: "Deploying F5 sites within AWS VPC environments",
			required: ["name", "namespace", "address", "aws_region", "disk_size", "instance_type", "ssh_key"],
			minimal_config:
				'resource "f5xc_aws_vpc_site" "example" {\n  name      = "example-aws-vpc-site"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  aws_region = "us-west-2"\n\n  aws_cred {\n    name      = "aws-credentials"\n    namespace = "staging"\n  }\n\n  vpc {\n    new_vpc {\n      name_tag     = "f5xc-vpc"\n      primary_ipv4 = "10.0.0.0/16"\n    }\n  }\n\n  instance_type = "t3.xlarge"\n\n  ingress_egress_gw {\n    aws_certified_hw = "aws-byol-multi-nic-voltmesh"\n    az_nodes {\n      aws_az_name = "us-west-2a"\n      inside_subnet {\n        subnet_param {\n          ipv4 = "10.0.1.0/24"\n        }\n      }\n      outside_subnet {\n        subnet_param {\n          ipv4 = "10.0.2.0/24"\n        }\n      }\n    }\n  }\n\n  no_worker_nodes {}\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_aws_vpc_site.example namespace/name",
		},
		azure_vnet_site: {
			category: "sites",
			description: "Deploying F5 sites within Azure Virtual Network environments",
			required: ["name", "namespace", "machine_type", "resource_group", "ssh_key"],
			server_defaults: ["disk_size", "block_all_services", "logs_streaming_disabled", "no_worker_nodes", "tags"],
			minimal_config:
				'resource "f5xc_azure_vnet_site" "example" {\n  name      = "example-Azure-vnet-site"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  azure_region = "westus2"\n\n  azure_cred {\n    name      = "Azure-credentials"\n    namespace = "staging"\n  }\n\n  resource_group = "f5xc-rg"\n\n  vnet {\n    new_vnet {\n      name         = "f5xc-vnet"\n      primary_ipv4 = "10.0.0.0/16"\n    }\n  }\n\n  machine_type = "Standard_D3_v2"\n\n  ingress_egress_gw {\n    azure_certified_hw = "Azure-byol-multi-nic-voltmesh"\n    az_nodes {\n      azure_az = "1"\n      inside_subnet {\n        subnet_param {\n          ipv4 = "10.0.1.0/24"\n        }\n      }\n      outside_subnet {\n        subnet_param {\n          ipv4 = "10.0.2.0/24"\n        }\n      }\n    }\n  }\n\n  no_worker_nodes {}\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_azure_vnet_site.example namespace/name",
		},
		bgp: {
			category: "networking",
			description:
				"Bgp object is the configuration for peering with external bgp servers. it is created by users in system namespace. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_bgp" "example" {\n  name      = "example-bgp"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  bgp_router_id = "192.168.1.1"\n\n  bgp_peers {\n    metadata {\n      name = "upstream-peer"\n    }\n    spec {\n      peer_asn     = 65000\n      peer_address = "192.168.1.2"\n    }\n  }\n\n  local_asn = 65001\n\n  site {\n    name      = "example-site"\n    namespace = "staging"\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_bgp.example namespace/name",
		},
		bgp_asn_set: {
			category: "networking",
			description: "Bgp_asn_set creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_bgp_asn_set" "example" {\n  name      = "example-bgp-asn-set"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_bgp_asn_set.example namespace/name",
		},
		bgp_routing_policy: {
			category: "security",
			description:
				"Bgp routing policy is a list of rules containing match criteria and action to be applied. these rules help control routes which are imported or exported to bgp peers. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_bgp_routing_policy" "example" {\n  name      = "example-bgp-routing-policy"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  rules {\n  }\n  action {\n  }\n  aggregate {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_bgp_routing_policy.example namespace/name",
		},
		bigip_http_proxy: {
			category: "big-ip-integration",
			description: "BIG-IP HTTP Proxy in a given namespace. If one already exists, it will give an error",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_bigip_http_proxy" "example" {\n  name      = "example-bigip-http-proxy"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  advanced_profile {\n  }\n  disable_spec {\n  }\n  enable_default_profile {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_bigip_http_proxy.example namespace/name",
		},
		bot_defense_app_infrastructure: {
			category: "security",
			description: "Bot Defense App Infrastructure in a given namespace",
			required: ["name", "namespace", "environment_type", "traffic_type"],
			minimal_config:
				'resource "f5xc_bot_defense_app_infrastructure" "example" {\n  name      = "example-bot-defense-app-infrastructure"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  cloud_hosted {\n  }\n  egress {\n  }\n  ingress {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_bot_defense_app_infrastructure.example namespace/name",
		},
		cdn_cache_rule: {
			category: "load-balancing",
			description: "CDN loadbalancer specification. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_cdn_cache_rule" "example" {\n  name      = "example-CDN-cache-rule"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  cache_rules {\n  }\n  cache_bypass {\n  }\n  eligible_for_cache {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_cdn_cache_rule.example namespace/name",
		},
		cdn_loadbalancer: {
			category: "load-balancing",
			description: "Content delivery and edge caching with load balancing",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_cdn_loadbalancer" "example" {\n  name      = "example-CDN-loadbalancer"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  domains = ["CDN.example.com"]\n\n  origin_pool {\n    public_name {\n      dns_name = "origin.example.com"\n    }\n    follow_origin_redirect = true\n    no_tls {}\n  }\n\n  cache_ttl_options {\n    cache_ttl_default = "1h"\n  }\n\n  https_auto_cert {\n    http_redirect = true\n  }\n\n  add_location = true\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_cdn_loadbalancer.example namespace/name",
		},
		cdn_purge_command: {
			category: "load-balancing",
			description: "CDN purge command specification. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_cdn_purge_command" "example" {\n  name      = "example-CDN-purge-command"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  hard_purge {\n  }\n  purge_all {\n  }\n  soft_purge {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_cdn_purge_command.example namespace/name",
		},
		certificate: {
			category: "certificates",
			description: "Certificate. configuration",
			required: ["name", "namespace", "certificate_url", "private_key"],
			minimal_config:
				'resource "f5xc_certificate" "example" {\n  name      = "example-certificate"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  certificate_url = "string:///LS0tLS1CRUdJTi..."\n  private_key {\n    clear_secret_info {\n      url = "string:///LS0tLS1CRUdJTi..."\n    }\n  }\n}',
			dependencies: {
				requires: ["namespace"],
			},
			import_syntax: "terraform import f5xc_certificate.example namespace/name",
		},
		certificate_chain: {
			category: "certificates",
			description: "Certificate chain configuration for TLS",
			required: ["name", "namespace", "certificate_url"],
			minimal_config:
				'resource "f5xc_certificate_chain" "example" {\n  name      = "example-certificate-chain"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_certificate_chain.example namespace/name",
		},
		cloud_connect: {
			category: "networking",
			description: "Establishing connectivity to cloud provider networks",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_cloud_connect" "example" {\n  name      = "example-cloud-connect"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  aws_provider {\n  }\n  aws_tgw_site {\n  }\n  cred {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_cloud_connect.example namespace/name",
		},
		cloud_credentials: {
			category: "authentication",
			description: "Api to create cloud_credentials object. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_cloud_credentials" "example" {\n  name      = "example-cloud-credentials"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  aws_secret_key {\n    access_key = "AKIAIOSFODNN7EXAMPLE"\n    secret_key {\n      clear_secret_info {\n        url = "string:///d0phbmVzc2VjcmV0a2V5"\n      }\n    }\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_cloud_credentials.example namespace/name",
		},
		cloud_elastic_ip: {
			category: "cloud-resources",
			description: "Cloud Elastic IP creates Cloud Elastic IP object Object is attached to a site",
			required: ["name", "namespace", "item_count"],
			minimal_config:
				'resource "f5xc_cloud_elastic_ip" "example" {\n  name      = "example-cloud-elastic-ip"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  site_ref {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_cloud_elastic_ip.example namespace/name",
		},
		cloud_link: {
			category: "networking",
			description: "New CloudLink with configured parameters",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_cloud_link" "example" {\n  name      = "example-cloud-link"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  aws {\n  }\n  aws_cred {\n  }\n  byoc {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_cloud_link.example namespace/name",
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
				'resource "f5xc_cluster" "example" {\n  name      = "example-cluster"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  auto_http_config {\n  }\n  circuit_breaker {\n  }\n  default_subset {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_cluster.example namespace/name",
		},
		cminstance: {
			category: "subscriptions",
			description: "App type will create the configuration in namespace metadata.namespace",
			required: ["name", "namespace", "port", "username"],
			minimal_config:
				'resource "f5xc_cminstance" "example" {\n  name      = "example-cminstance"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  api_token {\n  }\n  blindfold_secret_info {\n  }\n  clear_secret_info {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_cminstance.example namespace/name",
		},
		code_base_integration: {
			category: "integrations",
			description: "Integration details",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_code_base_integration" "example" {\n  name      = "example-code-base-integration"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  code_base_integration {\n  }\n  azure_repos {\n  }\n  access_token {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_code_base_integration.example namespace/name",
		},
		container_registry: {
			category: "kubernetes",
			description: "Container image registry configuration",
			required: ["name", "namespace", "email", "registry", "user_name"],
			minimal_config:
				'resource "f5xc_container_registry" "example" {\n  name      = "example-container-registry"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  password {\n  }\n  blindfold_secret_info {\n  }\n  clear_secret_info {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_container_registry.example namespace/name",
		},
		crl: {
			category: "certificates",
			description: "Api to create crl object. configuration",
			required: ["name", "namespace", "refresh_interval", "server_address", "server_port", "timeout"],
			minimal_config:
				'resource "f5xc_crl" "example" {\n  name      = "example-crl"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  http_access {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_crl.example namespace/name",
		},
		data_group: {
			category: "big-ip-integration",
			description: "Data group in a given namespace. If one already exists it will give an error",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_data_group" "example" {\n  name      = "example-data-group"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  address_records {\n  }\n  records {\n  }\n  integer_records {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_data_group.example namespace/name",
		},
		data_type: {
			category: "security",
			description: "Data_type creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace", "is_pii", "is_sensitive_data"],
			minimal_config:
				'resource "f5xc_data_type" "example" {\n  name      = "example-data-type"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  rules {\n  }\n  key_pattern {\n  }\n  exact_values {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_data_type.example namespace/name",
		},
		dc_cluster_group: {
			category: "networking",
			description: "DC Cluster group in given namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_dc_cluster_group" "example" {\n  name      = "example-dc-cluster-group"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  type {\n  }\n  control_and_data_plane_mesh {\n  }\n  data_plane_mesh {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_dc_cluster_group.example namespace/name",
		},
		discovery: {
			category: "applications",
			description: "Api to create discovery object for a site or virtual site in system namespace. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_discovery" "example" {\n  name      = "example-discovery"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  discovery_k8s {\n    access_info {\n      kubeconfig_url {\n        clear_secret_info {\n          url = "string:///base64-kubeconfig"\n        }\n      }\n      isolated {}\n    }\n    publish_info {\n      disable {}\n    }\n  }\n\n  where {\n    site {\n      ref {\n        name      = "example-site"\n        namespace = "staging"\n      }\n      network_type = "VIRTUAL_NETWORK_SITE_LOCAL_INSIDE"\n    }\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_discovery.example namespace/name",
		},
		dns_compliance_checks: {
			category: "dns",
			description:
				"DNS Compliance Checks Specification in a given namespace. If one already exists it will give an error",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_dns_compliance_checks" "example" {\n  name      = "example-dns-compliance-checks"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_dns_compliance_checks.example namespace/name",
		},
		dns_domain: {
			category: "dns",
			description: "DNS Domain in a given namespace. If one already exist it will give a error",
			required: ["name", "namespace", "dnssec_mode"],
			minimal_config:
				'resource "f5xc_dns_domain" "example" {\n  name      = "example-dns-domain"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  volterra_managed {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_dns_domain.example namespace/name",
		},
		dns_proxy: {
			category: "dns",
			description: "DNS Proxy in a given namespace. If one already exists it will give an error",
			required: ["name", "namespace", "transport_type"],
			minimal_config:
				'resource "f5xc_dns_proxy" "example" {\n  name      = "example-dns-proxy"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  cache_profile {\n  }\n  disable_cache_profile {\n  }\n  ddos_profile {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_dns_proxy.example namespace/name",
		},
		endpoint: {
			category: "load-balancing",
			description: "Endpoint will create the object in the storage backend for namespace metadata.namespace",
			required: ["name", "namespace", "health_check_port", "port", "protocol"],
			minimal_config:
				'resource "f5xc_endpoint" "example" {\n  name      = "example-endpoint"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  dns_name_advanced {\n  }\n  service_info {\n  }\n  service_selector {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_endpoint.example namespace/name",
		},
		enhanced_firewall_policy: {
			category: "security",
			description: "Enhanced firewall policy specification. configuration",
			required: ["name", "namespace"],
			server_defaults: ["allow_all"],
			minimal_config:
				'resource "f5xc_enhanced_firewall_policy" "example" {\n  name      = "example-enhanced-firewall-policy"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  rule_list {\n    rules {\n      metadata {\n        name = "allow-web-traffic"\n      }\n      allow {}\n      advanced_action {\n        action = "LOG"\n      }\n      source_prefix_list {\n        ip_prefix_set {\n          name      = "trusted-ips"\n          namespace = "staging"\n        }\n      }\n      all_traffic {}\n    }\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_enhanced_firewall_policy.example namespace/name",
		},
		external_connector: {
			category: "networking",
			description: "External_connector configuration specification. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_external_connector" "example" {\n  name      = "example-external-connector"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  ce_site_reference {\n  }\n  gre {\n  }\n  gre_parameters {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_external_connector.example namespace/name",
		},
		fast_acl: {
			category: "security",
			description:
				"Object, object contains rules to protect site from denial of service It has destination{destination IP, destination port) and references to",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_fast_acl" "example" {\n  name      = "example-fast-acl"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  protocol_policer {\n  }\n  re_acl {\n  }\n  all_public_vips {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_fast_acl.example namespace/name",
		},
		fast_acl_rule: {
			category: "security",
			description: "New Fast ACL rule, has specification to match source IP, source port and action to apply",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_fast_acl_rule" "example" {\n  name      = "example-fast-acl-rule"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  port {\n  }\n  all {\n  }\n  dns {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_fast_acl_rule.example namespace/name",
		},
		filter_set: {
			category: "applications",
			description: "Specification",
			required: ["name", "namespace", "context_key"],
			minimal_config:
				'resource "f5xc_filter_set" "example" {\n  name      = "example-filter-set"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  filter_fields {\n  }\n  date_field {\n  }\n  absolute {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_filter_set.example namespace/name",
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
				'resource "f5xc_fleet" "example" {\n  name      = "example-fleet"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  fleet_label = "env=production"\n\n  inside_virtual_network {\n    name      = "inside-network"\n    namespace = "staging"\n  }\n\n  outside_virtual_network {\n    name      = "outside-network"\n    namespace = "staging"\n  }\n\n  default_config {}\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_fleet.example namespace/name",
		},
		forward_proxy_policy: {
			category: "security",
			description: "Forward proxy policy specification. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_forward_proxy_policy" "example" {\n  name      = "example-forward-proxy-policy"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  proxy_label_selector {\n    expressions = ["app in (web, api)"]\n  }\n\n  drp_http_connect {\n    any_proxy {}\n    rule_list {\n      rules {\n        metadata {\n          name = "allow-external"\n        }\n        spec {\n          action = "ALLOW"\n          dst_list {\n            any_dst {}\n          }\n        }\n      }\n    }\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_forward_proxy_policy.example namespace/name",
		},
		forwarding_class: {
			category: "networking",
			description: "Forwarding class is created by users in system namespace. configuration",
			required: ["name", "namespace", "queue_id_to_use", "interface_group"],
			minimal_config:
				'resource "f5xc_forwarding_class" "example" {\n  name      = "example-forwarding-class"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  dscp {\n  }\n  dscp_based_queue {\n  }\n  no_marking {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_forwarding_class.example namespace/name",
		},
		gcp_vpc_site: {
			category: "sites",
			description: "Deploying F5 sites within Google Cloud VPC environments",
			required: ["name", "namespace", "address", "disk_size", "gcp_region", "instance_type", "ssh_key"],
			minimal_config:
				'resource "f5xc_gcp_vpc_site" "example" {\n  name      = "example-gcp-vpc-site"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  gcp_region = "us-west1"\n\n  cloud_credentials {\n    name      = "gcp-credentials"\n    namespace = "staging"\n  }\n\n  instance_type = "n1-standard-4"\n\n  ingress_egress_gw {\n    gcp_certified_hw = "gcp-byol-multi-nic-voltmesh"\n    node_number      = 1\n    inside_network {\n      new_network {\n        name = "inside-network"\n      }\n    }\n    outside_network {\n      new_network {\n        name = "outside-network"\n      }\n    }\n    inside_subnet {\n      new_subnet {\n        subnet_name  = "inside-subnet"\n        primary_ipv4 = "10.0.1.0/24"\n      }\n    }\n    outside_subnet {\n      new_subnet {\n        subnet_name  = "outside-subnet"\n        primary_ipv4 = "10.0.2.0/24"\n      }\n    }\n  }\n\n  no_worker_nodes {}\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_gcp_vpc_site.example namespace/name",
		},
		global_log_receiver: {
			category: "monitoring",
			description: "New Global Log Receiver object",
			required: ["name", "namespace", "log_type", "receiver_choice"],
			server_defaults: ["ns_current"],
			minimal_config:
				'resource "f5xc_global_log_receiver" "example" {\n  name      = "example-global-log-receiver"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  audit_logs {\n  }\n  aws_cloud_watch_receiver {\n  }\n  aws_cred {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_global_log_receiver.example namespace/name",
		},
		healthcheck: {
			category: "load-balancing",
			description:
				"Healthcheck object defines method to determine if the given endpoint is healthy. single healthcheck object can be referred to by one or many cluster objects. configuration",
			required: ["name", "namespace", "interval", "timeout", "healthy_threshold", "unhealthy_threshold"],
			oneof_groups: [
				{
					fields: ["http_health_check", "tcp_health_check", "udp_icmp_health_check"],
				},
				{
					parent: "http_health_check",
					fields: ["host_header", "use_origin_server_name"],
				},
				{
					parent: "http_health_check",
					fields: ["headers", "request_headers_to_remove"],
				},
			],
			server_defaults: ["jitter_percent"],
			minimal_config:
				'resource "f5xc_healthcheck" "example" {\n  name      = "example-healthcheck"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  // One of the arguments from this list "http_health_check tcp_health_check udp_icmp_health_check" must be set\n\n  http_health_check {\n    // One of the arguments from this list "host_header use_origin_server_name" must be set\n\n    use_origin_server_name {}\n\n    path                  = "/health"\n    use_http2             = false\n    expected_status_codes = ["200"]\n\n    // One of the arguments from this list "headers request_headers_to_remove" must be set\n\n    headers {}\n  }\n\n  healthy_threshold   = 3\n  unhealthy_threshold = 3\n  interval            = 15\n  timeout             = 5\n}',
			dependencies: {
				requires: ["namespace"],
				used_by: ["origin_pool"],
			},
			import_syntax: "terraform import f5xc_healthcheck.example namespace/name",
		},
		http_loadbalancer: {
			category: "load-balancing",
			description: "Load balancing HTTP/HTTPS traffic with advanced routing and security",
			required: ["name", "namespace", "domains"],
			oneof_groups: [
				{
					fields: [
						"advertise_custom",
						"advertise_on_public",
						"advertise_on_public_default_vip",
						"do_not_advertise",
					],
				},
				{
					fields: ["api_specification", "disable_api_definition"],
				},
				{
					fields: ["disable_api_discovery", "enable_api_discovery"],
				},
				{
					fields: ["api_testing", "disable_api_testing"],
				},
				{
					fields: [
						"captcha_challenge",
						"enable_challenge",
						"js_challenge",
						"no_challenge",
						"policy_based_challenge",
					],
				},
				{
					fields: [
						"cookie_stickiness",
						"least_active",
						"random",
						"ring_hash",
						"round_robin",
						"source_ip_stickiness",
					],
				},
				{
					fields: ["http", "https", "https_auto_cert"],
				},
				{
					parent: "https_auto_cert",
					fields: ["default_header", "no_headers", "server_name"],
				},
				{
					parent: "tls_config",
					fields: ["custom_security", "default_security", "low_security", "medium_security"],
				},
				{
					parent: "https_auto_cert",
					fields: ["no_mtls", "use_mtls"],
				},
				{
					fields: ["disable_malicious_user_detection", "enable_malicious_user_detection"],
				},
				{
					fields: ["disable_malware_protection", "malware_protection_settings"],
				},
				{
					fields: ["api_rate_limit", "disable_rate_limit", "rate_limit"],
				},
				{
					fields: ["default_sensitive_data_policy", "sensitive_data_policy"],
				},
				{
					fields: ["active_service_policies", "no_service_policies", "service_policies_from_namespace"],
				},
				{
					fields: ["disable_threat_mesh", "enable_threat_mesh"],
				},
				{
					fields: ["disable_trust_client_ip_headers", "enable_trust_client_ip_headers"],
				},
				{
					fields: ["user_id_client_ip", "user_identification"],
				},
				{
					fields: ["app_firewall", "disable_waf"],
				},
				{
					fields: ["bot_defense", "bot_defense_advanced", "disable_bot_defense"],
				},
			],
			server_defaults: [
				"add_location",
				"endpoint_selection",
				"loadbalancer_algorithm",
				"healthcheck",
				"no_tls",
				"same_as_endpoint_port",
				"default_sensitive_data_policy",
				"disable_api_definition",
				"disable_api_discovery",
				"disable_api_testing",
				"disable_malware_protection",
				"disable_rate_limit",
				"disable_threat_mesh",
				"disable_trust_client_ip_headers",
				"l7_ddos_protection",
				"round_robin",
				"service_policies_from_namespace",
				"user_id_client_ip",
			],
			minimal_config:
				'resource "f5xc_http_loadbalancer" "example" {\n  name      = "example-http-loadbalancer"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  // One of the arguments from this list "advertise_custom advertise_on_public advertise_on_public_default_vip do_not_advertise" must be set\n\n  advertise_on_public_default_vip {}\n\n  // One of the arguments from this list "api_specification disable_api_definition" must be set\n\n  disable_api_definition {}\n\n  // One of the arguments from this list "disable_api_discovery enable_api_discovery" must be set\n\n  disable_api_discovery {}\n\n  // One of the arguments from this list "api_testing disable_api_testing" must be set\n\n  disable_api_testing {}\n\n  // One of the arguments from this list "captcha_challenge enable_challenge js_challenge no_challenge policy_based_challenge" must be set\n\n  no_challenge {}\n\n  domains = ["app.example.com", "`www.example.com"`]\n\n  // One of the arguments from this list "cookie_stickiness least_active random ring_hash round_robin source_ip_stickiness" must be set\n\n  round_robin {}\n\n  // One of the arguments from this list "http https https_auto_cert" must be set\n\n  https_auto_cert {\n    http_redirect = true\n    add_hsts      = true\n\n    // One of the arguments from this list "default_header no_headers server_name" must be set\n\n    default_header {}\n\n    tls_config {\n      // One of the arguments from this list "custom_security default_security low_security medium_security" must be set\n\n      default_security {}\n    }\n\n    // One of the arguments from this list "no_mtls use_mtls" must be set\n\n    no_mtls {}\n  }\n\n  // One of the arguments from this list "disable_malicious_user_detection enable_malicious_user_detection" must be set\n\n  enable_malicious_user_detection {}\n\n  // One of the arguments from this list "disable_malware_protection malware_protection_settings" must be set\n\n}',
			dependencies: {
				requires: ["namespace", "origin_pool"],
				used_by: ["route"],
			},
			import_syntax: "terraform import f5xc_http_loadbalancer.example namespace/name",
		},
		ike1: {
			category: "vpn",
			description: "Ike phase1 profile specification. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_ike1" "example" {\n  name      = "example-ike1"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  ike_keylifetime_hours {\n  }\n  ike_keylifetime_minutes {\n  }\n  reauth_disabled {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_ike1.example namespace/name",
		},
		ike2: {
			category: "vpn",
			description: "Ike phase2 profile specification. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_ike2" "example" {\n  name      = "example-ike2"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  dh_group_set {\n  }\n  disable_pfs {\n  }\n  ike_keylifetime_hours {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_ike2.example namespace/name",
		},
		ike_phase1_profile: {
			category: "vpn",
			description: "Ike phase1 profile specification. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_ike_phase1_profile" "example" {\n  name      = "example-ike-phase1-profile"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  ike_keylifetime_hours {\n  }\n  ike_keylifetime_minutes {\n  }\n  reauth_disabled {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_ike_phase1_profile.example namespace/name",
		},
		ike_phase2_profile: {
			category: "vpn",
			description: "Ike phase2 profile specification. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_ike_phase2_profile" "example" {\n  name      = "example-ike-phase2-profile"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  dh_group_set {\n  }\n  disable_pfs {\n  }\n  ike_keylifetime_hours {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_ike_phase2_profile.example namespace/name",
		},
		ip_prefix_set: {
			category: "networking",
			description: "Ip_prefix_set creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_ip_prefix_set" "example" {\n  name      = "example-ip-prefix-set"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  prefix = ["192.168.1.0/24", "10.0.0.0/8"]\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_ip_prefix_set.example namespace/name",
		},
		irule: {
			category: "big-ip-integration",
			description: "IRule in a given namespace. If one already exists it will give an error",
			required: ["name", "namespace", "description", "description_spec", "irule"],
			minimal_config:
				'resource "f5xc_irule" "example" {\n  name      = "example-irule"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_irule.example namespace/name",
		},
		k8s_cluster: {
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
			minimal_config:
				'resource "f5xc_k8s_cluster" "example" {\n  name      = "example-k8s-cluster"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  use_custom_cluster_role_bindings {\n    cluster_role_bindings {\n      name      = "admin-binding"\n      namespace = "staging"\n    }\n  }\n\n  cluster_wide_app_list {\n    cluster_wide_apps {\n      name      = "nginx-ingress"\n      namespace = "staging"\n    }\n  }\n\n  local_access_config {\n    local_domain = "cluster.local"\n    default_port {}\n  }\n\n  global_access_enable {}\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_k8s_cluster.example namespace/name",
		},
		k8s_cluster_role: {
			category: "kubernetes",
			description: "K8s_cluster_role will create the object in the storage backend for namespace metadata.namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_k8s_cluster_role" "example" {\n  name      = "example-k8s-cluster-role"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  k8s_cluster_role_selector {\n  }\n  policy_rule_list {\n  }\n  policy_rule {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_k8s_cluster_role.example namespace/name",
		},
		k8s_cluster_role_binding: {
			category: "kubernetes",
			description:
				"K8s_cluster_role_binding will create the object in the storage backend for namespace metadata.namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_k8s_cluster_role_binding" "example" {\n  name      = "example-k8s-cluster-role-binding"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  subjects {\n  }\n  service_account {\n  }\n  k8s_cluster_role {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_k8s_cluster_role_binding.example namespace/name",
		},
		k8s_pod_security_admission: {
			category: "kubernetes",
			description: "K8s_pod_security_admission will create the object in the storage backend",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_k8s_pod_security_admission" "example" {\n  name      = "example-k8s-pod-security-admission"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  pod_security_admission_specs {\n  }\n  audit {\n  }\n  baseline {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_k8s_pod_security_admission.example namespace/name",
		},
		k8s_pod_security_policy: {
			category: "security",
			description:
				"K8s_pod_security_policy will create the object in the storage backend for namespace metadata.namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_k8s_pod_security_policy" "example" {\n  name      = "example-k8s-pod-security-policy"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  psp_spec {\n  }\n  allowed_capabilities {\n  }\n  allowed_host_paths {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_k8s_pod_security_policy.example namespace/name",
		},
		log_receiver: {
			category: "monitoring",
			description: "New Log Receiver object",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_log_receiver" "example" {\n  name      = "example-log-receiver"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  http_receiver {\n    uri = "`https://logs.example.com/ingest"`\n    batch {\n      max_bytes       = 1048576\n      max_events      = 100\n      timeout_seconds = 5\n    }\n    no_tls_verify_hostname {}\n    no_compression {}\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_log_receiver.example namespace/name",
		},
		malicious_user_mitigation: {
			category: "security",
			description: "Malicious_user_mitigation creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace"],
			server_defaults: ["mitigation_type"],
			minimal_config:
				'resource "f5xc_malicious_user_mitigation" "example" {\n  name      = "example-malicious-user-mitigation"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  mitigation_type {\n    rules {\n      threat_level {\n        high {}\n      }\n      mitigation_action {\n        block_temporarily {}\n      }\n    }\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_malicious_user_mitigation.example namespace/name",
		},
		namespace: {
			category: "organization",
			description: "New namespace. Name of the object is name of the namespace",
			required: ["name"],
			minimal_config:
				'resource "f5xc_namespace" "example" {\n  name      = "example-namespace"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  description = "Example namespace for application workloads"\n}',
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
			import_syntax: "terraform import f5xc_namespace.example namespace/name",
		},
		nat_policy: {
			category: "security",
			description: "Nat policy create specification configures nat policy with multiple rules,. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_nat_policy" "example" {\n  name      = "example-nat-policy"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  rules {\n  }\n  action {\n  }\n  dynamic {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_nat_policy.example namespace/name",
		},
		network_connector: {
			category: "networking",
			description: "Network connector is created by users in system namespace. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_network_connector" "example" {\n  name      = "example-network-connector"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  sli_to_global_dr {\n    global_vn {\n      name      = "global-network"\n      namespace = "staging"\n    }\n  }\n\n  disable_forward_proxy {}\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_network_connector.example namespace/name",
		},
		network_firewall: {
			category: "security",
			description: "Network firewall is created by users in system namespace. configuration",
			required: ["name", "namespace"],
			server_defaults: ["disable_fast_acl", "disable_forward_proxy_policy", "disable_network_policy"],
			minimal_config:
				'resource "f5xc_network_firewall" "example" {\n  name      = "example-network-firewall"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  active_enhanced_firewall_policies {\n  }\n  enhanced_firewall_policies {\n  }\n  active_fast_acls {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_network_firewall.example namespace/name",
		},
		network_interface: {
			category: "networking",
			description:
				"Network interface represents configuration of a network device. it is created by users in system namespace. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_network_interface" "example" {\n  name      = "example-network-interface"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  dedicated_interface {\n  }\n  cluster {\n  }\n  is_primary {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_network_interface.example namespace/name",
		},
		network_policy: {
			category: "security",
			description: "New network policy with configured parameters in specified namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_network_policy" "example" {\n  name      = "example-network-policy"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  endpoint {\n    any {}\n  }\n\n  ingress_rules {\n    metadata {\n      name = "allow-http"\n    }\n    spec {\n      action = "ALLOW"\n      any    = {}\n    }\n  }\n\n  egress_rules {\n    metadata {\n      name = "allow-all-egress"\n    }\n    spec {\n      action = "ALLOW"\n      any    = {}\n    }\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_network_policy.example namespace/name",
		},
		network_policy_rule: {
			category: "security",
			description: "Network policy rule with configured parameters in specified namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_network_policy_rule" "example" {\n  name      = "example-network-policy-rule"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  advanced_action {\n  }\n  ip_prefix_set {\n  }\n  ref {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_network_policy_rule.example namespace/name",
		},
		network_policy_view: {
			category: "security",
			description: "Network policy view specification. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_network_policy_view" "example" {\n  name      = "example-network-policy-view"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  egress_rules {\n  }\n  adv_action {\n  }\n  all_tcp_traffic {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_network_policy_view.example namespace/name",
		},
		nfv_service: {
			category: "networking",
			description: "New NFV service with configured parameters",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_nfv_service" "example" {\n  name      = "example-nfv-service"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  disable_https_management {\n  }\n  disable_ssh_access {\n  }\n  enabled_ssh_access {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_nfv_service.example namespace/name",
		},
		nginx_service_discovery: {
			category: "networking",
			description:
				"Api to create nginx service discovery object for a site or virtual site in system namespace. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_nginx_service_discovery" "example" {\n  name      = "example-nginx-service-discovery"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  discovery_target {\n  }\n  config_sync_group {\n  }\n  nginx_instance {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_nginx_service_discovery.example namespace/name",
		},
		origin_pool: {
			category: "load-balancing",
			description: "Defining backend server pools for load balancer targets",
			required: ["name", "namespace", "origin_servers", "port"],
			oneof_groups: [
				{
					parent: "origin_servers",
					fields: [
						"consul_service",
						"custom_endpoint_object",
						"k8s_service",
						"private_ip",
						"private_name",
						"public_ip",
						"public_name",
						"vn_private_ip",
						"vn_private_name",
					],
				},
				{
					parent: "k8s_service",
					fields: ["inside_network", "outside_network", "vk8s_networks"],
				},
				{
					parent: "site_locator",
					fields: ["site", "virtual_site"],
				},
				{
					fields: ["no_tls", "use_tls"],
				},
				{
					parent: "use_tls",
					fields: ["disable_sni", "sni", "use_host_header_as_sni"],
				},
				{
					parent: "tls_config",
					fields: ["custom_security", "default_security", "low_security", "medium_security"],
				},
				{
					parent: "use_tls",
					fields: ["no_mtls", "use_mtls", "use_mtls_obj"],
				},
				{
					parent: "use_tls",
					fields: ["skip_server_verification", "use_server_verification", "volterra_trusted_ca"],
				},
			],
			server_defaults: [
				"endpoint_selection",
				"loadbalancer_algorithm",
				"healthcheck",
				"no_tls",
				"same_as_endpoint_port",
			],
			minimal_config:
				'resource "f5xc_origin_pool" "example" {\n  name      = "example-origin-pool"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  // Origin servers configuration\n  origin_servers {\n    // One of the arguments from this list "consul_service custom_endpoint_object k8s_service private_ip private_name public_ip public_name vn_private_ip vn_private_name" must be set\n\n    public_name {\n      dns_name         = "origin.example.com"\n      refresh_interval = 60\n    }\n  }\n\n  origin_servers {\n    // One of the arguments from this list "consul_service custom_endpoint_object k8s_service private_ip private_name public_ip public_name vn_private_ip vn_private_name" must be set\n\n    k8s_service {\n      service_name = "backend-svc"\n\n      // One of the arguments from this list "inside_network outside_network vk8s_networks" must be set\n\n      vk8s_networks {}\n\n      site_locator {\n        // One of the arguments from this list "site virtual_site" must be set\n\n        site {\n          name      = "example-site"\n          namespace = "staging"\n        }\n      }\n    }\n  }\n\n  port = 443\n\n  // One of the arguments from this list "no_tls use_tls" must be set\n\n  use_tls {\n    // One of the arguments from this list "disable_sni sni use_host_header_as_sni" must be set\n\n    sni = "backend.example.com"\n\n    tls_config {\n      // One of the arguments from this list "custom_security default_security low_security medium_security" must be set\n\n      default_security {}\n    }\n\n    // One of the arguments from this list "no_mtls use_mtls use_mtls_obj" must be set\n\n    no_mtls {}\n\n    // One of the arguments from this list "skip_server_verification use_server_verification volterra_trusted_ca" must be set\n\n    volterra_trusted_ca {}\n  }\n\n  // Health check configuration\n  healthcheck {\n    name      = "example-healthcheck"\n    namespace = "staging"\n  }\n\n  // Load balancing configuration\n}',
			dependencies: {
				requires: ["namespace", "healthcheck"],
				used_by: ["http_loadbalancer", "tcp_loadbalancer", "udp_loadbalancer"],
			},
			import_syntax: "terraform import f5xc_origin_pool.example namespace/name",
		},
		policer: {
			category: "service-mesh",
			description: "New policer with traffic rate limits",
			required: ["name", "namespace", "burst_size", "committed_information_rate"],
			server_defaults: ["policer_mode", "policer_type"],
			minimal_config:
				'resource "f5xc_policer" "example" {\n  name      = "example-policer"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_policer.example namespace/name",
		},
		policy_based_routing: {
			category: "networking",
			description: "Network policy based routing create specification. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_policy_based_routing" "example" {\n  name      = "example-policy-based-routing"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  forwarding_class_list {\n  }\n  forward_proxy_pbr {\n  }\n  forward_proxy_pbr_rules {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_policy_based_routing.example namespace/name",
		},
		protocol_inspection: {
			category: "security",
			description:
				"Protocol Inspection Specification in a given namespace. If one already exists it will give an error",
			required: ["name", "namespace", "enable_disable_compliance_checks", "enable_disable_signatures"],
			server_defaults: ["action"],
			minimal_config:
				'resource "f5xc_protocol_inspection" "example" {\n  name      = "example-protocol-inspection"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  enable_disable_compliance_checks {\n  }\n  disable_compliance_checks {\n  }\n  enable_compliance_checks {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_protocol_inspection.example namespace/name",
		},
		protocol_policer: {
			category: "security",
			description:
				"Protocol_policer object, protocol_policer object contains list of L4 protocol match condition and corresponding traffic rate limits",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_protocol_policer" "example" {\n  name      = "example-protocol-policer"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  protocol_policer {\n  }\n  policer {\n  }\n  protocol {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_protocol_policer.example namespace/name",
		},
		proxy: {
			category: "networking",
			description: "Tcp loadbalancer create specification. configuration",
			required: ["name", "namespace", "connection_timeout"],
			minimal_config:
				'resource "f5xc_proxy" "example" {\n  name      = "example-proxy"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  proxy_url = "`http://proxy.example.com:8080"`\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_proxy.example namespace/name",
		},
		rate_limiter: {
			category: "security",
			description: "Rate_limiter creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace"],
			server_defaults: ["user_identification"],
			minimal_config:
				'resource "f5xc_rate_limiter" "example" {\n  name      = "example-rate-limiter"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  limits {\n    total_number     = 100\n    unit             = "MINUTE"\n    burst_multiplier = 10\n  }\n}',
			dependencies: {
				requires: ["namespace"],
			},
			import_syntax: "terraform import f5xc_rate_limiter.example namespace/name",
		},
		rate_limiter_policy: {
			category: "security",
			description: "Rate limiter policy create specification. configuration",
			required: ["name", "namespace", "burst_size", "committed_information_rate"],
			server_defaults: ["rules"],
			minimal_config:
				'resource "f5xc_rate_limiter_policy" "example" {\n  name      = "example-rate-limiter-policy"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  any_server {\n  }\n  server_name_matcher {\n  }\n  server_selector {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_rate_limiter_policy.example namespace/name",
		},
		route: {
			category: "load-balancing",
			description:
				"Route object in a given namespace. Route object is list of route rules. Each rule has match condition to match incoming requests and actions to take on matching requests",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_route" "example" {\n  name      = "example-route"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  routes {\n    match {\n      path {\n        prefix = "/api/"\n      }\n    }\n    route_destination {\n      destinations {\n        cluster {\n          name      = "api-cluster"\n          namespace = "staging"\n        }\n        weight = 100\n      }\n    }\n  }\n}',
			dependencies: {
				requires: ["namespace", "http_loadbalancer"],
			},
			import_syntax: "terraform import f5xc_route.example namespace/name",
		},
		secret_management_access: {
			category: "authentication",
			description: "Secret_management_access creates a new object in storage backend for metadata.namespace",
			required: ["name", "namespace", "provider_name"],
			minimal_config:
				'resource "f5xc_secret_management_access" "example" {\n  name      = "example-secret-management-access"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  access_info {\n  }\n  rest_auth_info {\n  }\n  basic_auth {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_secret_management_access.example namespace/name",
		},
		securemesh_site: {
			category: "sites",
			description: "Deploying secure mesh edge sites with distributed security capabilities",
			required: ["name", "namespace", "address", "volterra_certified_hw"],
			minimal_config:
				'resource "f5xc_securemesh_site" "example" {\n  name      = "example-securemesh-site"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  generic {\n    not_managed {\n      node_list {\n        hostname  = "node1.example.com"\n        public_ip = "203.0.113.10"\n        type      = "Control"\n      }\n    }\n  }\n\n  master_nodes_count = 1\n\n  default_fleet_config {}\n\n  disable_ha {}\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_securemesh_site.example namespace/name",
		},
		securemesh_site_v2: {
			category: "sites",
			description: "Deploying secure mesh edge sites with enhanced security and networking features",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_securemesh_site_v2" "example" {\n  name      = "example-securemesh-site-v2"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  performance_enhancement_mode {\n  }\n  perf_mode_l3_enhanced {\n  }\n  jumbo {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_securemesh_site_v2.example namespace/name",
		},
		segment: {
			category: "networking",
			description: "Segment. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_segment" "example" {\n  name      = "example-segment"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  disable_spec {\n  }\n  enable {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_segment.example namespace/name",
		},
		sensitive_data_policy: {
			category: "security",
			description: "Sensitive_data_policy creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace"],
			server_defaults: ["compliances", "disabled_predefined_data_types", "custom_data_types"],
			minimal_config:
				'resource "f5xc_sensitive_data_policy" "example" {\n  name      = "example-sensitive-data-policy"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  custom_data_types {\n  }\n  custom_data_type_ref {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_sensitive_data_policy.example namespace/name",
		},
		service_policy: {
			category: "security",
			description: "Service_policy creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace"],
			oneof_groups: [
				{
					fields: ["allow_all_requests", "allow_list", "deny_all_requests", "deny_list", "rule_list"],
				},
				{
					fields: ["any_server", "server_name", "server_name_matcher", "server_selector"],
				},
			],
			server_defaults: ["port_matcher", "any_server"],
			minimal_config:
				'resource "f5xc_service_policy" "example" {\n  name      = "example-service-policy"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  // One of the arguments from this list "allow_all_requests allow_list deny_all_requests deny_list rule_list" must be set\n\n  rule_list {\n    rules {\n      metadata {\n        name = "allow-api"\n      }\n      spec {\n        action = "ALLOW"\n        any_client {}\n        any_ip {}\n        path {\n          prefix_values = ["/api/"]\n        }\n      }\n    }\n  }\n\n  // One of the arguments from this list "any_server server_name server_name_matcher server_selector" must be set\n\n  any_server {}\n}',
			dependencies: {
				requires: ["namespace"],
			},
			import_syntax: "terraform import f5xc_service_policy.example namespace/name",
		},
		service_policy_rule: {
			category: "security",
			description: "Service_policy_rule creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace"],
			server_defaults: ["port_matcher"],
			minimal_config:
				'resource "f5xc_service_policy_rule" "example" {\n  name      = "example-service-policy-rule"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  any_asn {\n  }\n  any_client {\n  }\n  any_ip {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_service_policy_rule.example namespace/name",
		},
		site: {
			category: "sites",
			description: "Virtual site object in given namespace",
			required: ["name", "namespace", "site_type"],
			minimal_config:
				'resource "f5xc_site" "example" {\n  name      = "example-site"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  site_selector {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_site.example namespace/name",
		},
		site_mesh_group: {
			category: "sites",
			description: "Site Mesh Group in system namespace of user",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_site_mesh_group" "example" {\n  name      = "example-site-mesh-group"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  type = "SITE_MESH_GROUP_TYPE_FULL_MESH"\n\n  full_mesh {\n    control_and_data_plane_mesh {}\n  }\n\n  hub {}\n\n  virtual_site {\n    name      = "example-virtual-site"\n    namespace = "staging"\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_site_mesh_group.example namespace/name",
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
				'resource "f5xc_srv6_network_slice" "example" {\n  name      = "example-srv6-network-slice"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_srv6_network_slice.example namespace/name",
		},
		subnet: {
			category: "networking",
			description:
				"Subnet object contains configuration for an interface of a vm/pod. it is created in user or shared namespace. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_subnet" "example" {\n  name      = "example-subnet"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  site_subnet_params {\n  }\n  dhcp {\n  }\n  site {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_subnet.example namespace/name",
		},
		tcp_loadbalancer: {
			category: "load-balancing",
			description: "Load balancing TCP traffic across origin pools",
			required: ["name", "namespace", "origin_pools"],
			oneof_groups: [
				{
					fields: [
						"advertise_custom",
						"advertise_on_public",
						"advertise_on_public_default_vip",
						"do_not_advertise",
					],
				},
			],
			server_defaults: [
				"dns_volterra_managed",
				"idle_timeout",
				"hash_policy_choice_round_robin",
				"no_sni",
				"retract_cluster",
				"service_policies_from_namespace",
				"tcp",
			],
			minimal_config:
				'resource "f5xc_tcp_loadbalancer" "example" {\n  name      = "example-tcp-loadbalancer"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  listen_port = 8443\n\n  // One of the arguments from this list "advertise_custom advertise_on_public advertise_on_public_default_vip do_not_advertise" must be set\n\n  advertise_on_public_default_vip {}\n\n  origin_pools_weights {\n    pool {\n      name      = "example-tcp-pool"\n      namespace = "staging"\n    }\n    weight = 1\n  }\n\n  dns_volterra_managed = true\n\n  retract_cluster {}\n}',
			dependencies: {
				requires: ["namespace", "origin_pool"],
			},
			import_syntax: "terraform import f5xc_tcp_loadbalancer.example namespace/name",
		},
		tenant_configuration: {
			category: "organization",
			description: "Tenant configuration specification. configuration",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_tenant_configuration" "example" {\n  name      = "example-tenant-configuration"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  basic_configuration {\n  }\n  brute_force_detection {\n  }\n  brute_force_detection_settings {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_tenant_configuration.example namespace/name",
		},
		trusted_ca_list: {
			category: "certificates",
			description: "Trusted certificate authority list management",
			required: ["name", "namespace", "trusted_ca_url"],
			minimal_config:
				'resource "f5xc_trusted_ca_list" "example" {\n  name      = "example-trusted-ca-list"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  trusted_ca_url = "string:///LS0tLS1CRUdJTi..."\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_trusted_ca_list.example namespace/name",
		},
		tunnel: {
			category: "networking",
			description: "Tunnel in a given namespace. If one already exist it will give a error",
			required: ["name", "namespace", "tunnel_type"],
			minimal_config:
				'resource "f5xc_tunnel" "example" {\n  name      = "example-tunnel"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  tunnel_type = "IPSEC_PSK"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_tunnel.example namespace/name",
		},
		udp_loadbalancer: {
			category: "load-balancing",
			description: "Load balancing UDP traffic across origin pools",
			required: ["name", "namespace", "dns_volterra_managed", "enable_per_packet_load_balancing", "idle_timeout"],
			minimal_config:
				'resource "f5xc_udp_loadbalancer" "example" {\n  name      = "example-udp-loadbalancer"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  domains                          = ["dns.example.com"]\n  listen_port                      = 53\n  idle_timeout                     = 30000\n  enable_per_packet_load_balancing = true\n\n  dns_volterra_managed = true\n\n  advertise_on_public_default_vip {}\n}',
			dependencies: {
				requires: ["namespace", "origin_pool"],
			},
			import_syntax: "terraform import f5xc_udp_loadbalancer.example namespace/name",
		},
		usb_policy: {
			category: "security",
			description: "New USB policy object",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_usb_policy" "example" {\n  name      = "example-usb-policy"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  allowed_devices {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_usb_policy.example namespace/name",
		},
		user_identification: {
			category: "security",
			description: "User_identification creates a new object in the storage backend for metadata.namespace",
			required: ["name", "namespace", "rules"],
			minimal_config:
				'resource "f5xc_user_identification" "example" {\n  name      = "example-user-identification"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  rules {\n    client_ip {}\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_user_identification.example namespace/name",
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
				'resource "f5xc_virtual_host" "example" {\n  name      = "example-virtual-host"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  domains                     = ["app.example.com"]\n  proxy                       = "DNS_PROXY"\n  idle_timeout                = 30000\n  connection_idle_timeout     = 120000\n  max_request_header_size     = 32768\n  add_location                = false\n  disable_dns_resolve         = false\n  disable_default_error_pages = false\n  request_headers_to_remove   = []\n  response_headers_to_remove  = []\n  request_cookies_to_remove   = []\n  response_cookies_to_remove  = []\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_virtual_host.example namespace/name",
		},
		virtual_k8s: {
			category: "kubernetes",
			description: "Virtual_k8s will create the object in the storage backend for namespace metadata.namespace",
			required: ["name", "namespace"],
			minimal_config:
				'resource "f5xc_virtual_k8s" "example" {\n  name      = "example-virtual-k8s"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  default_flavor_ref {\n  }\n  disabled {\n  }\n  isolated {\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_virtual_k8s.example namespace/name",
		},
		virtual_network: {
			category: "networking",
			description: "Virtual network in given namespace",
			required: ["name", "namespace", "legacy_type"],
			minimal_config:
				'resource "f5xc_virtual_network" "example" {\n  name      = "example-virtual-network"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  legacy_type = "VIRTUAL_NETWORK_SITE_LOCAL"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_virtual_network.example namespace/name",
		},
		virtual_site: {
			category: "sites",
			description: "Virtual site object in given namespace",
			required: ["name", "namespace", "site_type", "site_selector"],
			minimal_config:
				'resource "f5xc_virtual_site" "example" {\n  name      = "example-virtual-site"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  site_type = "CUSTOMER_EDGE"\n\n  site_selector {\n    expressions = ["region in (us-west-2, us-east-1)"]\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_virtual_site.example namespace/name",
		},
		voltstack_site: {
			category: "sites",
			description: "Deploying Volterra stack sites for edge computing",
			required: ["name", "namespace", "address", "volterra_certified_hw"],
			minimal_config:
				'resource "f5xc_voltstack_site" "example" {\n  name      = "example-voltstack-site"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  volterra_certified_hw = "kvm-voltstack-combo"\n  worker_nodes          = []\n  address               = "123 Main St, Example City, EX 12345"\n\n  k8s_cluster {\n    name      = "example-k8s-cluster"\n    namespace = "staging"\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_voltstack_site.example namespace/name",
		},
		waf_exclusion_policy: {
			category: "security",
			description: "WAF exclusion policy",
			required: ["name", "namespace", "waf_exclusion_rules"],
			oneof_groups: [
				{
					parent: "waf_exclusion_rules",
					fields: ["any_domain", "exact_value", "suffix_value"],
				},
				{
					parent: "waf_exclusion_rules",
					fields: ["any_path", "path_prefix", "path_regex"],
				},
			],
			minimal_config:
				'resource "f5xc_waf_exclusion_policy" "example" {\n  name      = "example-waf-exclusion-policy"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  waf_exclusion_rules {\n    // One of the arguments from this list "any_domain exact_value suffix_value" must be set\n\n    any_domain {}\n\n    // One of the arguments from this list "any_path path_prefix path_regex" must be set\n\n    any_path {}\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_waf_exclusion_policy.example namespace/name",
		},
		workload: {
			category: "kubernetes",
			description: "Workload. configuration",
			required: ["name", "namespace"],
			oneof_groups: [
				{
					fields: ["job", "service", "stateful_service"],
				},
			],
			minimal_config:
				'resource "f5xc_workload" "example" {\n  name      = "example-workload"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  // One of the arguments from this list "job service stateful_service" must be set\n\n  service {\n    containers {\n      name = "web"\n      image {\n        name        = "nginx"\n        pull_policy = "IMAGE_PULL_POLICY_ALWAYS"\n        public {}\n      }\n    }\n    deploy_options {\n      default_virtual_sites {}\n    }\n  }\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_workload.example namespace/name",
		},
		workload_flavor: {
			category: "kubernetes",
			description: "Workload_flavor",
			required: ["name", "namespace", "ephemeral_storage", "memory", "vcpus"],
			minimal_config:
				'resource "f5xc_workload_flavor" "example" {\n  name      = "example-workload-flavor"\n  namespace = "staging"\n\n  labels = {\n    environment = "production"\n    managed_by  = "terraform"\n  }\n\n  annotations = {\n    "owner" = "platform-team"\n  }\n\n  vcpus             = 1\n  memory            = "1024"\n  ephemeral_storage = "1024"\n}',
			dependencies: {
				requires: [],
			},
			import_syntax: "terraform import f5xc_workload_flavor.example namespace/name",
		},
	},
} as const;
