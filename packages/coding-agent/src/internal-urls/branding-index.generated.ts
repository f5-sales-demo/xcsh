// AUTO-GENERATED — do not edit. Run `bun generate-branding-index` to regenerate.

export const BRANDING_VERSION = "1.0.0";

export const BRANDING_CANONICAL = {
	managed_kubernetes: {
		long_form: "F5 XC Managed Kubernetes",
		short_form: "XCKS",
		full_acronym: "XC Kubernetes Service",
		description:
			"Enterprise-grade Kubernetes cluster management comparable to AWS EKS, Azure AKS, and Google GKE. Full cluster control with RBAC, pod security, and container registry management.\n",
		legacy_names: ["AppStack", "VoltStack", "voltstack_site"],
		comparable_to: ["AWS EKS", "Azure AKS", "Google GKE"],
		use_cases: [
			"Deploy and manage Kubernetes clusters on-premises or in cloud",
			"Configure RBAC roles and cluster security policies",
			"Manage container registries and pod security admission",
			"Integrate with existing enterprise Kubernetes infrastructure",
		],
	},
	container_services: {
		long_form: "F5 XC Container Services",
		short_form: "XCCS",
		full_acronym: "XC Container Services",
		description:
			"Simplified, multi-tenant container orchestration comparable to AWS ECS and Azure Container Services. Optimized for distributed edge deployments with restricted Kubernetes capabilities (no operators, CRDs, privileged mode).\n",
		legacy_names: ["Virtual Kubernetes", "vK8s", "virtual_k8s"],
		comparable_to: ["AWS ECS", "Azure Container Services", "Cloud Run"],
		use_cases: [
			"Deploy container workloads across distributed edge sites",
			"Run multi-tenant containerized applications",
			"Simplified container orchestration without K8s complexity",
			"Edge-optimized container deployments",
		],
	},
} as const;

export const BRANDING_DEPRECATIONS = undefined as const;

export const BRANDING_GLOSSARY = {
	XCKS: {
		term: "XC Kubernetes Service",
		definition: "F5's enterprise managed Kubernetes offering (comparable to AWS EKS, Azure AKS)",
		legacy: "Formerly known as AppStack",
	},
	XCCS: {
		term: "XC Container Services",
		definition: "F5's multi-tenant container orchestration service (comparable to AWS ECS)",
		legacy: "Formerly known as Virtual Kubernetes (vK8s)",
	},
	CE: {
		term: "Customer Edge",
		definition: "F5's edge deployment infrastructure for distributed applications",
	},
	RE: {
		term: "Regional Edge",
		definition: "F5's globally distributed edge network infrastructure",
	},
} as const;

export const BRANDING_DOMAIN = {
	container_services: {
		title: "XCCS - XC Container Services",
		description:
			'F5 XC Container Services (XCCS) provides simplified, multi-tenant container orchestration comparable to AWS ECS and Azure Container Services. Optimized for distributed edge deployments with restricted Kubernetes capabilities. Formerly known as "Virtual Kubernetes" (vK8s).\n',
	},
	managed_kubernetes: {
		title: "XCKS - XC Kubernetes Service",
		description:
			'F5 XC Managed Kubernetes (XCKS) provides enterprise-grade Kubernetes cluster management comparable to AWS EKS, Azure AKS, and Google GKE. Full cluster control with RBAC, pod security, and container registry management. Formerly known as "AppStack".\n',
	},
	sites: {
		title: "Customer Edge Sites",
		description:
			"Site deployment and management across cloud providers (AWS VPC, Azure VNET, GCP VPC), F5 XC Managed Kubernetes (XCKS, formerly AppStack) deployments, and Secure Mesh deployments for networking-focused edge sites.\n",
	},
} as const;
