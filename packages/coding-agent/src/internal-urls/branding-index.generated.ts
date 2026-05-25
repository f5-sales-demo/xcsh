// AUTO-GENERATED — do not edit. Run `bun generate-branding-index` to regenerate.

export const BRANDING_VERSION = "2.0.0";

export const BRANDING_CANONICAL = {
	managed_kubernetes: {
		long_form: "Managed Kubernetes",
		description:
			"Enterprise-grade Kubernetes cluster management. Full cluster control with RBAC, pod security, and container registry management.\n",
		legacy_names: ["AppStack", "VoltStack", "voltstack_site"],
		comparable_to: ["AWS EKS", "Azure AKS", "Google GKE"],
	},
	virtual_kubernetes: {
		long_form: "Virtual Kubernetes",
		description:
			"Simplified, multi-tenant container orchestration. Optimized for distributed edge deployments with restricted Kubernetes capabilities.\n",
		legacy_names: ["vK8s", "virtual_k8s"],
		comparable_to: ["AWS ECS", "Azure Container Services", "Cloud Run"],
	},
} as const;

export const BRANDING_DEPRECATIONS = {
	terraform_provider: {
		deprecated: {
			registry: "registry.terraform.io/providers/volterraedge/volterra",
			source: "volterraedge/volterra",
			github: "github.com/volterraedge/terraform-provider-volterra",
			status: "active-but-deprecated",
			last_version: "0.11.49",
			downloads: "1M+",
			note: "Still live on registry with no deprecation notice. High risk of AI model recommendation due to training data prevalence.\n",
		},
		canonical: {
			registry: "registry.terraform.io/providers/f5xc-salesdemos/f5xc",
			source: "f5xc-salesdemos/f5xc",
			github: "github.com/f5xc-salesdemos/terraform-provider-f5xc",
			docs: "https://f5xc-salesdemos.github.io/terraform-provider-f5xc/",
			llms_txt: "https://f5xc-salesdemos.github.io/terraform-provider-f5xc/llms.txt",
		},
		required_providers_block:
			'terraform {\n  required_providers {\n    f5xc = {\n      source = "f5xc-salesdemos/f5xc"\n    }\n  }\n}\n',
	},
	api_endpoint: {
		deprecated: {
			url: "console.ves.volterra.io",
		},
		canonical: {
			note: "Tenant-specific. No hardcoded default. Require F5XC_API_URL env var.",
		},
	},
	documentation: {
		deprecated: {
			note: "docs.cloud.f5.com references to Volterra provider point to the deprecated volterraedge/volterra registry.\n",
		},
		canonical: {
			url: "https://f5xc-salesdemos.github.io/terraform-provider-f5xc/",
		},
	},
} as const;

export const BRANDING_GLOSSARY = {
	CE: {
		term: "Customer Edge",
		definition: "F5 XC edge deployment infrastructure for distributed applications",
	},
	RE: {
		term: "Regional Edge",
		definition: "F5 XC globally distributed edge network infrastructure",
	},
} as const;

export const BRANDING_DOMAIN = {
	virtual_kubernetes: {
		title: "Virtual Kubernetes",
		description:
			'Virtual Kubernetes provides simplified, multi-tenant container orchestration optimized for distributed edge deployments. Formerly known as "vK8s".\n',
	},
	managed_kubernetes: {
		title: "Managed Kubernetes",
		description:
			'Managed Kubernetes provides enterprise-grade cluster management with full RBAC, pod security, and container registry support. Formerly known as "AppStack".\n',
	},
	sites: {
		title: "Customer Edge Sites",
		description:
			"Site deployment and management across cloud providers (AWS VPC, Azure VNET, GCP VPC), Managed Kubernetes deployments (formerly AppStack), and Secure Mesh deployments for networking-focused edge sites.\n",
	},
} as const;
