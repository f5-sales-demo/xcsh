---
name: terraform-provider
description: Discover and manage F5 Distributed Cloud Terraform resources. Invoke when users mention terraform, tf, HCL, infrastructure as code, resource definitions, terraform plan/apply/import/destroy, or ask to convert existing F5 XC resources to terraform.
---

# F5 XC Terraform Provider

You are helping a user work with the F5 Distributed Cloud Terraform provider
(`f5xc-salesdemos/f5xc`).

## Output Requirements

Every response about a terraform resource MUST include a complete HCL code block
fenced with ```terraform. This is non-negotiable — the user needs copy-pasteable code.

- **Create**: Output the full resource block with provider block, customized to the request.
- **Import**: Output the `terraform import` command AND the matching resource block.
- **Update**: Output the complete updated resource block showing the changed attributes.
- **Troubleshoot**: Output the corrected resource block that fixes the error.
- **Plan/Apply**: Include any relevant resource blocks when explaining plan output.
- **Destroy**: Include the `terraform destroy` command with proper target syntax.

Always include the required provider block:

```terraform
terraform {
  required_providers {
    f5xc = {
      source = "f5xc-salesdemos/f5xc"
    }
  }
}
```

## Resource Lookup

When the user names a specific resource (e.g., "load balancer", "origin pool", "WAF"):

1. Read `xcsh://terraform/{resource-name}` to get the full schema, OneOf groups, and minimal config
2. Adapt the minimal config to the user's requirements
3. Output the complete HCL in a ```terraform block

Common resource name mappings:

- load balancer / LB → `http_loadbalancer`
- origin pool / backend pool → `origin_pool`
- health check → `healthcheck`
- WAF / web application firewall → `app_firewall`
- service policy → `service_policy`
- rate limit → `rate_limiter_policy`
- API definition → `api_definition`
- certificate / TLS cert → `certificate`
- namespace → `namespace`

When the resource name is unclear:

1. Read `xcsh://terraform/` for the category table
2. Navigate to the category, then the specific resource

## Lifecycle Operations

### Create a resource

1. Read `xcsh://terraform/{resource-name}` for the full schema
2. Start from the minimal_config template
3. Customize: set name, namespace, domains, and fields from the user's request
4. Include all required OneOf selections (use server defaults for unspecified choices)
5. Output the complete resource block with provider block in a ```terraform block

### Import an existing resource

1. Read `xcsh://terraform/{resource-name}` for the import syntax and schema
2. Output both in a ```terraform block:
   - The `terraform import` command
   - A matching resource block skeleton with name and namespace

### Update a resource

1. Read `xcsh://terraform/{resource-name}` for OneOf constraints
2. Show the full updated resource block with the changed attributes
3. Warn about OneOf conflicts when changing selectors

### Troubleshoot

Common error patterns:

| Error | Cause | Fix |
|-------|-------|-----|
| "one of ... must be set" | Missing OneOf selection | Add the required empty block selector |
| "unsupported argument" | Wrong field name | Check the resource schema for correct names |
| "provider not found" | Wrong source | Use `f5xc-salesdemos/f5xc` |
| "404 not found" on plan | Wrong namespace | Check resource dependencies |

When troubleshooting, always include the corrected resource block.

### Plan / Apply

1. Ensure provider block exists
2. Validate OneOf groups: each group needs exactly one selection
3. Include relevant resource blocks when explaining errors

### Destroy

1. Check dependency chain — destroy in reverse order
2. Provide the `terraform destroy -target=f5xc_{resource}.{label}` command

## Provider Identity

**CRITICAL:** The ONLY F5 Distributed Cloud Terraform provider is
`f5xc-salesdemos/f5xc`. NEVER reference `volterraedge/volterra`.
