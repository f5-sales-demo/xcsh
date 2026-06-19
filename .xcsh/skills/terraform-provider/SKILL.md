---
name: terraform-provider
description: |
  Generate F5 XC Terraform HCL code. Activate ONLY when the user explicitly asks for Terraform, HCL, .tf files, infrastructure-as-code, or terraform import/plan/apply/destroy. Do NOT activate for direct CRUD operations (create, read, update, delete a resource by name) — those use the xcsh_api tool, not Terraform.
  Provider: f5xc-salesdemos/f5xc (NEVER volterraedge/volterra). Read skill://terraform-provider for templates.
---

# F5 XC Terraform Provider

Every response MUST include a ```terraform code block. Output code first, then write it to a `.tf` file with `xcsh_write_file`.

MINIMUM-SETTINGS (match the JSON/YAML export style): emit ONLY fields that change behavior — the required skeleton, required fields, and any value the user explicitly asks to set. OMIT fields the server applies by default unless the user wants a non-default value. Examples to omit at their defaults: `origin_pool` `loadbalancer_algorithm = "ROUND_ROBIN"` and `endpoint_selection = "DISTRIBUTED"`; `healthcheck` default `timeout`/`interval`/`unhealthy_threshold`/`healthy_threshold`; empty server-default oneof variants (`round_robin {}`, `same_as_endpoint_port {}`) when they are the default choice. Fields documented "Server applies default when omitted" are safe to omit. Keep configs small and default-free.

WRITE-AND-VERIFY (when asked to write/generate Terraform — the default): after writing the file, verify it WITHOUT mutating the tenant:
1. `terraform fmt` the file (canonical formatting; needs no provider/init).
2. `terraform init` (best-effort), then `terraform validate` (syntax + provider-schema check). If `init` fails (e.g. a `dev_overrides` setup in `~/.terraformrc`, or offline), DO NOT abort — still run `terraform validate` (it works under `dev_overrides` without init) and report both results plainly. `validate` is the "verified working" signal.
3. Stop. Report the file path and the fmt/validate result. Writing a plan is NOT running it.
NEVER run `terraform apply` unless the user clearly asks to create/CRUD a resource (and CRUD-by-name uses the `xcsh_api` tool, not Terraform). NEVER auto-run `terraform plan` — run it only when the user explicitly asks to plan/preview/diff. `terraform destroy` only on explicit request.

REQUIRED skeleton — every `.tf` MUST contain BOTH the `terraform {}` block AND a `provider "f5xc" {}` block, not just resource snippets. Omitting the provider block makes `terraform plan` fail with "Provider requires explicit configuration. Add a provider block":
terraform { required_providers { f5xc = { source = "f5xc-salesdemos/f5xc" } } }
provider "f5xc" {}
Auth comes from env vars (set ONE): F5XC_API_TOKEN | F5XC_P12_FILE+F5XC_P12_PASSWORD | F5XC_CERT+F5XC_KEY; tenant URL via F5XC_API_URL. Keep the provider block empty unless asked to hardcode credentials.

Templates (adapt name/namespace/fields per request):

http_loadbalancer: resource "f5xc_http_loadbalancer" "example" { name="example" namespace="default" domains=["app.example.com"] advertise_on_public_default_vip {} http { port=80 } default_route_pools { pool { name="origin-pool-name" namespace="default" } weight=1 priority=1 } }
Pool ref: set pool.name to existing origin pool name in same namespace. HTTPS: replace http { port=80 } with https_auto_cert { http_redirect=true default_header {} tls_config { default_security {} } no_mtls {} }. WAF: add disable_waf {} or app_firewall { name="waf" namespace="ns" }. Import: terraform import f5xc_http_loadbalancer.example ns/name

origin_pool: resource "f5xc_origin_pool" "example" { name="example" namespace="default" port=8080 origin_servers { public_ip { ip="10.0.1.10" } } loadbalancer_algorithm="ROUND_ROBIN" endpoint_selection="LOCAL_PREFERRED" }
Healthcheck ref: add healthcheck { name="hc" namespace="ns" }. Import: terraform import f5xc_origin_pool.example ns/name

healthcheck: resource "f5xc_healthcheck" "example" { name="example" namespace="default" http_health_check { path="/healthz" } timeout=3 interval=10 unhealthy_threshold=3 healthy_threshold=3 }
TCP: replace http_health_check with tcp_health_check {}. Import: terraform import f5xc_healthcheck.example ns/name

app_firewall: resource "f5xc_app_firewall" "example" { name="example" namespace="default" blocking {} }
Import: terraform import f5xc_app_firewall.example ns/name

service_policy: resource "f5xc_service_policy" "example" { name="example" namespace="default" allow_all_requests {} any_server {} }
Deny all: replace allow_all_requests {} with deny_all_requests {}. Custom rules: use rule_list { rules { metadata { name="rule" } spec { action="ALLOW" any_client {} any_ip {} } } }. Import: terraform import f5xc_service_policy.example ns/name

certificate: resource "f5xc_certificate" "example" { name="example" namespace="default" certificate_url="string:///BASE64_CERT" private_key { blindfold_secret_info { location="string:///BASE64_KEY" } } }
Import: terraform import f5xc_certificate.example ns/name

rate_limiter_policy: resource "f5xc_rate_limiter_policy" "example" { name="example" namespace="default" any_server {} }
Import: terraform import f5xc_rate_limiter_policy.example ns/name

api_definition: resource "f5xc_api_definition" "example" { name="example" namespace="default" swagger_specs=["string:///BASE64_SPEC"] }
Import: terraform import f5xc_api_definition.example ns/name

namespace: resource "f5xc_namespace" "example" { name="staging" }
Labels: add labels = { env="prod" }. Import: terraform import f5xc_namespace.example name

Troubleshoot: "one of X must be set" = add empty block. "unsupported argument" = check template. Output corrected resource block.
Destroy: terraform destroy -target=f5xc_{type}.{label}
