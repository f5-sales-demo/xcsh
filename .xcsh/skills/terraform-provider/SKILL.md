---
name: terraform-provider
description: |
  Senior DevOps Terraform & IaC capability for F5 XC and ecosystem providers.
  Activate ONLY when the user explicitly asks for "Terraform", "HCL", ".tf" files, "infrastructure-as-code", or terraform import/plan/apply/destroy.
  Provider: f5-sales-demo/xcsh (NEVER volterraedge/volterra). Read skill://terraform-provider for templates and operational best practices.
---

# F5 XC Senior DevOps Terraform Guide

Every response MUST include a ```terraform code block. Output clean code first, then write to file.

## Proactive Registry Lookup Rule
BEFORE writing any `required_providers` block or external module invocation:
1. Query `xcsh://registry/provider/{namespace}/{type}` or search the HashiCorp Provider Registry to discover the latest provider version constraint (e.g. `~> 1.2.0`).
2. Query `xcsh://registry/module/{namespace}/{name}/{provider}` for module inputs/outputs.
3. NEVER guess provider versions or invent non-existent module arguments.

## Senior DevOps Engineering Standards

### 1. Required Provider & Source Skeleton
Every `.tf` entrypoint MUST include the required providers block and provider block:
```hcl
terraform {
  required_version = ">= 1.5.0"
  required_providers {
    xcsh = {
      source  = "f5-sales-demo/xcsh"
      version = "~> 0.1.0"
    }
  }
}

provider "xcsh" {}
```
Auth comes from env vars (set ONE): `XCSH_API_TOKEN` | `XCSH_P12_FILE`+`XCSH_P12_PASSWORD` | `XCSH_CERT`+`XCSH_KEY`; tenant URL via `XCSH_API_URL`. Keep provider configuration clean and environment-driven.

### 2. Variable & Output Engineering (`variables.tf` & `outputs.tf`)
- ALWAYS specify explicit `type` constraints for variables (`type = string`, `type = list(string)`).
- Include `description` and `validation` blocks with human-readable error messages for variable constraints.
- Mark sensitive parameters (passwords, tokens, private keys) with `sensitive = true`.
- Document all outputs with `description` and mark sensitive outputs appropriately.

Example:
```hcl
variable "namespace" {
  type        = string
  description = "Target F5 XC namespace for resources"
  default     = "default"

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.namespace))
    error_message = "Namespace must consist of lowercase alphanumeric characters and hyphens."
  }
}

output "loadbalancer_domains" {
  type        = list(string)
  description = "Configured public domains for the HTTP load balancer"
  value       = xcsh_http_loadbalancer.example.domains
}
```

### 3. Minimum Settings & Default Hygiene
Emit ONLY parameters that change operational behavior or are explicitly required by the user. OMIT fields that the server/provider applies by default (e.g. `loadbalancer_algorithm = "ROUND_ROBIN"`, `endpoint_selection = "DISTRIBUTED"`).

### 4. Modular & Portable Architecture
- Keep root modules lean. Separate concerns into `main.tf`, `variables.tf`, `outputs.tf`, and `terraform.tfvars.example`.
- Enforce environment independence — never hardcode tenant URLs, passwords, or hardcoded IP addresses.

### 5. Automated Testing (`*.tftest.hcl`)
When creating production infrastructure code, include a native `terraform test` file:
```hcl
run "verify_loadbalancer_name" {
  command = plan

  assert {
    condition     = xcsh_http_loadbalancer.example.name == "app-lb"
    error_message = "HTTP Load Balancer name must match app-lb"
  }
}
```

### 6. Write-and-Verify Lifecycle
1. `terraform fmt` for canonical formatting.
2. `terraform init` (best effort), followed by `terraform validate`. Report syntax and provider validation status plainly.
3. NEVER run `terraform apply` or `terraform destroy` without explicit user instruction.

### 7. Troubleshooting Playbook
- **Missing OneOf block**: Error `"one of X must be set"` -> supply explicit empty block `field {}`.
- **Unsupported argument**: Verify parameter against Level 2 schema (`xcsh://terraform/{category}/{resource}`).
- **State lock error**: Resolve via `terraform force-unlock <lock-id>` when instructed.
