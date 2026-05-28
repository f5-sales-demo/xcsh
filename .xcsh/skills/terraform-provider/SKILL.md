---
name: terraform-provider
description: Discover and manage F5 Distributed Cloud Terraform resources. Invoke when users mention terraform, tf, HCL, infrastructure as code, resource definitions, terraform plan/apply/import/destroy, or ask to convert existing F5 XC resources to terraform.
---

# F5 XC Terraform Provider

You are helping a user work with the F5 Distributed Cloud Terraform provider
(`f5xc-salesdemos/f5xc`). Use progressive discovery to load only what is
needed — do not read all layers at once.

## Progressive Discovery

### Layer 1 — Provider overview

When the user first mentions terraform, or asks a general question:

1. Read `xcsh://terraform/` for the provider index
2. Present: provider source, syntax rules, category table
3. Ask which category or resource they need

### Layer 2 — Category detail

When the user names a category or you can infer it from context:

1. Read `xcsh://terraform/{category-slug}` for the resource list
2. Present: resources in the category, dependency chain
3. Ask which specific resource they need, or recommend based on intent

### Layer 3 — Resource detail

When the user names a specific resource or you need full schema:

1. Read `xcsh://terraform/{category-slug}/{resource-name}` for the L2 doc
2. Use the OneOf groups, required fields, and minimal config to guide the user
3. If the resource has no L2 doc, try `xcsh://terraform/{resource-name}` directly

## Lifecycle Operations

### Create a resource

1. Read L2 for the target resource
2. Generate HCL using the minimal config as a starting template
3. Customize: ask the user for name, namespace, domain, and operation-specific fields
4. Include all required OneOf selections (use server defaults when appropriate)
5. Show the complete resource block

### Import an existing resource

1. Use the xcsh_api tool to GET the existing resource from the F5 XC API:
   - paths: `["/{resource_type}"]`, namespace: `"{namespace}"`
2. Read L2 for the terraform resource schema
3. Map API response fields to terraform attributes
4. Generate: `terraform import f5xc_{resource}.{label} {namespace}/{name}`
5. Generate the matching resource block in HCL

### Update a resource

1. Read L2 for the resource to understand OneOf constraints
2. Identify which attributes to change
3. Show the updated resource block
4. Warn about OneOf conflicts (changing one selector may require removing another)

### Plan / Apply

1. Ensure the user has `terraform init` completed (provider block exists)
2. Validate OneOf groups: each group must have exactly one selection
3. Run `terraform plan` and interpret the output
4. If errors reference OneOf or missing fields, look them up in L2

### Troubleshoot

Common error patterns and where to look:

| Error | Cause | Fix |
|-------|-------|-----|
| "one of ... must be set" | Missing OneOf selection | Check L2 OneOf Groups section |
| "unsupported argument" | Wrong field name | Check L2 Required + OneOf sections |
| "provider not found" | Wrong source | Use `f5xc-salesdemos/f5xc` (NEVER volterraedge/volterra) |
| "404 not found" on plan | Wrong namespace | Check L2 Dependencies for namespace requirement |
| "already exists" | Resource name conflict | Use a unique name or import the existing resource |
| "permission denied" | Wrong API token scope | Verify F5XC_API_TOKEN has access to the namespace |

### Destroy

1. Check the dependency chain from L2 — destroy in reverse order
2. Resources that are "Used by" others must be destroyed last
3. Run `terraform destroy -target=f5xc_{resource}.{label}` for selective removal

## Provider Identity

**CRITICAL:** The ONLY current F5 Distributed Cloud Terraform provider is
`f5xc-salesdemos/f5xc`. NEVER reference or generate code using
`volterraedge/volterra` — that provider is deprecated.
