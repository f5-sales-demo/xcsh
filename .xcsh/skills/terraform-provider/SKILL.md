---
name: terraform-provider
description: |
  Generate F5 XC Terraform HCL code. Activate ONLY when the user explicitly asks for "Terraform", "HCL", ".tf" files, "infrastructure-as-code", or terraform import/plan/apply/destroy. NEVER activate for generic resource keywords or un-specified infrastructure requests — those default to native XC-API (`xcsh_api`) and JSON manifests (`{kind, metadata, spec}`).
  Provider: f5-sales-demo/xcsh (NEVER volterraedge/volterra). Read skill://terraform-provider for templates.
---

# F5 XC Terraform Provider

For explicit Terraform questions, begin with the bundled `xcsh://terraform-documentation/` search and read the
selected complete section before answering. Cite its exact destination and bundled provider version. When
retrieval reports narrowing choices, ask one focused question about the missing provider role or schema branch
and wait for the answer before drafting HCL. Missing user-specific values such as certificate location also
require clarification before populating those values. Explain documented alternatives without supplying
parallel HCL drafts while the destination is undecided.

Generate a Terraform code block when the user asks for HCL and the documented destination is resolved. Write a
`.tf` file with `xcsh_write_file` when the user asks to create or edit files. Documentation answers and
clarification questions do not require code or file writes. Verify every field and nested block against the
bundled exact sections; templates below are starting examples and must be checked against that version.
Distinguish documented provider validation from observed live-apply evidence.

REGISTRY-FIRST: before adding any external `required_providers` entry, read
`xcsh://registry/provider/<namespace>/<type>`. Before invoking a Registry module, read
`xcsh://registry/module/<namespace>/<name>/<provider>`. Never guess a namespace, provider type, module provider,
version, input, or output. Select a constraint only after reconciling Registry metadata with the caller's compatibility
requirements and existing lock file.

SENIOR TERRAFORM STRUCTURE:

- Give every input in `variables.tf` an explicit `type` and `description`. Add a `validation {}` block with a useful
  `error_message` for values constrained by naming, range, or format rules. Mark credentials and private material with
  `sensitive = true`.
- Put operator-relevant IDs, names, and endpoints in `outputs.tf`, with a `description` and `sensitive = true` whenever
  the value reveals a secret.
- Keep the root module small and split reusable concerns into focused child modules. Do not hardcode tenant URLs,
  credentials, environment names, or environment-specific addresses.
- For production modules, add native `*.tftest.hcl` coverage and run `terraform test` only when the user explicitly requests its plan or apply operations after format/init/validate. A
  typical assertion uses `run "validate_configuration" { command = plan ... }`; tests must not apply infrastructure
  unless the user explicitly authorizes that behavior.

Example validated input and documented output:

```terraform
variable "namespace" {
  type        = string
  description = "Target F5 XC namespace"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]*[a-z0-9]$", var.namespace))
    error_message = "Namespace must use lowercase letters, digits, and hyphens."
  }
}

output "load_balancer_domains" {
  description = "Public domains configured on the load balancer"
  value       = xcsh_http_loadbalancer.example.domains
}
```

MINIMUM-SETTINGS (match the JSON/YAML export style): emit ONLY fields that change behavior — the required skeleton,
required fields, and any value the user explicitly asks to set. OMIT fields the server applies by default unless the
user wants a non-default value. Examples to omit at their defaults: `origin_pool` `loadbalancer_algorithm =
"ROUND_ROBIN"` and `endpoint_selection = "DISTRIBUTED"`; `healthcheck` default
`timeout`/`interval`/`unhealthy_threshold`/`healthy_threshold`; empty server-default oneof variants (`round_robin {}`,
`same_as_endpoint_port {}`) when they are the default choice. Fields documented "Server applies default when omitted"
are safe to omit. Keep configs small and default-free.

RUNTIME PROVIDER SELECTION:

Use the injected Terraform preflight result before generation. The compact lookup is
`xcsh://registry/provider/f5-sales-demo/xcsh?view=latest`. For new and existing configurations, default to the
exact discovered constraint `version = "= <discovered-version>"`. An explicit user instruction to retain another
version takes precedence. Report selected and embedded documentation versions separately. When the Registry fails,
state that the latest release could not be checked. Use last verified metadata, otherwise the embedded version;
do not downgrade an existing newer pin because of fallback.

Read the embedded canonical corpus first. When selected and embedded versions differ and required information is
missing or validation exposes a schema difference, fetch only relevant `documentation/` pages via
`xcsh://terraform-release/v<selected-version>/documentation/<page>/index.md`. This resolves the release to its
immutable commit. Fetch `documentation/llms.txt` only when needed to locate a page absent from the embedded corpus.
Missing embedded documentation does not establish that a newer provider lacks a feature. Cite the returned public
URL and source version of each page. Internal URIs are tool reads.

WRITE-AND-VERIFY (when asked to write/generate Terraform — the default):

1. Read existing constraints and `.terraform.lock.hcl`; update xcsh to the selected exact version while preserving
   unrelated provider constraints. Respect explicit version overrides.
2. Run `terraform fmt`, then `terraform init -upgrade` when the selected pin requires lock refresh; otherwise
   `terraform init`. Report resulting lock-file changes, including unrelated provider changes.
3. Run `terraform validate` and verify the selected version in `.terraform.lock.hcl`. Initialization must install
   the published binary. Disclose `dev_overrides`; validation under an override cannot prove validation against the
   selected published release. If installation fails, still run validate where possible, deliver the draft with
   the failure identified, and make no successful-validation claim. Repair schema differences using targeted
   canonical release pages; if repair fails, identify the draft and failure.
4. Report file paths, selected and embedded versions, and format/init/validate/lock results.

NEVER run `terraform apply` unless the user explicitly requests that operation. NEVER auto-run `terraform plan` —
run it only when explicitly requested to plan/preview/diff. Run `terraform destroy` only on explicit request.

REQUIRED skeleton — every `.tf` MUST contain BOTH the `terraform {}` block AND a `provider "xcsh" {}` block, not just resource snippets. Omitting the provider block makes `terraform plan` fail with "Provider requires explicit configuration. Add a provider block":
terraform { required_providers { xcsh = { source = "f5-sales-demo/xcsh", version = "= <discovered-version>" } } }
provider "xcsh" {}
Auth comes from env vars (set ONE): XCSH_API_TOKEN | XCSH_P12_FILE+XCSH_P12_PASSWORD | XCSH_CERT+XCSH_KEY; tenant URL via XCSH_API_URL. Keep the provider block empty unless asked to hardcode credentials.

Templates (adapt name/namespace/fields per request):

http_loadbalancer: resource "xcsh_http_loadbalancer" "example" { name="example" namespace="default" domains=["app.example.com"] advertise_on_public_default_vip {} http { port=80 } default_route_pools { pool { name="origin-pool-name" namespace="default" } weight=1 priority=1 } }
Pool ref: set pool.name to existing origin pool name in same namespace. HTTPS: replace http { port=80 } with https_auto_cert { http_redirect=true default_header {} tls_config { default_security {} } no_mtls {} }. WAF: add disable_waf {} or app_firewall { name="waf" namespace="example-namespace" }. Import: terraform import xcsh_http_loadbalancer.example example-namespace/name

origin_pool: resource "xcsh_origin_pool" "example" { name="example" namespace="default" port=8080 origin_servers { public_ip { ip="10.0.1.10" } } loadbalancer_algorithm="ROUND_ROBIN" endpoint_selection="LOCAL_PREFERRED" }
Healthcheck ref: add healthcheck { name="hc" namespace="example-namespace" }. Import: terraform import xcsh_origin_pool.example example-namespace/name

healthcheck: resource "xcsh_healthcheck" "example" { name="example" namespace="default" http_health_check { path="/healthz" } timeout=3 interval=10 unhealthy_threshold=3 healthy_threshold=3 }
TCP: replace http_health_check with tcp_health_check {}. Import: terraform import xcsh_healthcheck.example ns/name

app_firewall: resource "xcsh_app_firewall" "example" { name="example" namespace="default" blocking {} }
Import: terraform import xcsh_app_firewall.example ns/name

service_policy: resource "xcsh_service_policy" "example" { name="example" namespace="default" allow_all_requests {} any_server {} }
Deny all: replace allow_all_requests {} with deny_all_requests {}. Custom rules: use rule_list { rules { metadata { name="rule" } spec { action="ALLOW" any_client {} any_ip {} } } }. Import: terraform import xcsh_service_policy.example ns/name

certificate: resource "xcsh_certificate" "example" { name="example" namespace="default" certificate_url="string:///BASE64_CERT" private_key { blindfold_secret_info { location="string:///BASE64_KEY" } } }
Import: terraform import xcsh_certificate.example ns/name

rate_limiter_policy: resource "xcsh_rate_limiter_policy" "example" { name="example" namespace="default" any_server {} }
Import: terraform import xcsh_rate_limiter_policy.example ns/name

api_definition: resource "xcsh_api_definition" "example" { name="example" namespace="default" swagger_specs=["string:///BASE64_SPEC"] }
Import: terraform import xcsh_api_definition.example ns/name

xcsh_namespace: resource "xcsh_namespace" "example" { name="example-staging" }
Labels: add labels = { env="prod" }. Import: terraform import xcsh_namespace.example name

Troubleshoot: "one of X must be set" = add empty block. "unsupported argument" = check template. Output corrected resource block.
Troubleshooting detail: **Unsupported argument** means the installed provider schema and configuration disagree;
read the relevant exact `xcsh://terraform-documentation/` section and the selected provider version before changing
HCL. A **State lock** must be investigated for an active writer first; use `terraform force-unlock <lock-id>` only
when the user instructs it and the stale lock identity is verified. Provider installation failures require checking
the exact source, version constraint, lock file, Registry availability, and any `dev_overrides` before retrying.
Destroy: terraform destroy -target=xcsh_{type}.{label}

When citing exact property documentation, distinguish provider validators/defaults and schema field flags from receipt-pinned upstream constraints. Describe a limit as provider-enforced only when the provider schema or validator code documents it. Label limits found only in upstream metadata as documented upstream constraints; neither source establishes successful live apply.
