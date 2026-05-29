---
name: terraform-provider
description: Discover and manage F5 Distributed Cloud Terraform resources. Invoke when users mention terraform, tf, HCL, infrastructure as code, resource definitions, terraform plan/apply/import/destroy, or ask to convert existing F5 XC resources to terraform.
---

# F5 XC Terraform Provider

Provider: `f5xc-salesdemos/f5xc`. NEVER use `volterraedge/volterra`.

## Output Rules

1. Every response MUST include a ```terraform fenced code block with complete, valid HCL.
2. Be concise. Output the code block first, then brief explanation if needed.
3. Always include the provider block and the resource block together.
4. For import: output both the resource block and the `terraform import` command.
5. For troubleshoot: output the corrected resource block.
6. For destroy: output the `terraform destroy -target` command.

## Provider Block

```terraform
terraform {
  required_providers {
    f5xc = { source = "f5xc-salesdemos/f5xc" }
  }
}
```

## Resource Templates

Use these templates as starting points. Customize name, namespace, and fields per the user's request.

### http_loadbalancer

```terraform
resource "f5xc_http_loadbalancer" "example" {
  name      = "example"
  namespace = "default"
  domains   = ["app.example.com"]

  advertise_on_public_default_vip {}
  no_challenge {}
  round_robin {}
  https_auto_cert {
    http_redirect = true
    default_header {}
    tls_config { default_security {} }
    no_mtls {}
  }
}
```

Required: name, namespace, domains. Key OneOf groups: advertise (advertise_on_public_default_vip/advertise_custom/do_not_advertise), protocol (http/https/https_auto_cert), challenge (no_challenge/js_challenge), lb_algorithm (round_robin/least_active/random).
WAF: add `app_firewall { name = "waf-name" namespace = "ns" }` and remove `disable_waf {}`.
Import: `terraform import f5xc_http_loadbalancer.example namespace/name`

### origin_pool

```terraform
resource "f5xc_origin_pool" "example" {
  name      = "example"
  namespace = "default"
  port      = 8080

  origin_servers {
    public_ip {
      ip = "10.0.1.10"
    }
  }

  loadbalancer_algorithm = "LB_OVERRIDE_ROUND_ROBIN"
  endpoint_selection      = "LOCAL_PREFERRED"
}
```

Required: name, namespace, port, origin_servers. Origin server types: public_ip, public_name, private_ip, private_name, k8s_service.
Healthcheck: add `healthcheck { name = "hc-name" namespace = "ns" }`.
Import: `terraform import f5xc_origin_pool.example namespace/name`

### healthcheck

```terraform
resource "f5xc_healthcheck" "example" {
  name      = "example"
  namespace = "default"

  http_health_check {
    path = "/healthz"
  }
  timeout             = 3
  interval            = 10
  unhealthy_threshold = 3
  healthy_threshold   = 3
}
```

Required: name, namespace, one of http_health_check/tcp_health_check.
TCP variant: replace `http_health_check` block with `tcp_health_check {}`.
Import: `terraform import f5xc_healthcheck.example namespace/name`

### app_firewall

```terraform
resource "f5xc_app_firewall" "example" {
  name      = "example"
  namespace = "default"

  blocking {}
}
```

Required: name, namespace. Mode: blocking {} or monitoring {}.
Import: `terraform import f5xc_app_firewall.example namespace/name`

### service_policy

```terraform
resource "f5xc_service_policy" "example" {
  name      = "example"
  namespace = "default"

  algo      = "FIRST_MATCH"
  any_server = true

  rules {
    metadata {
      name = "allow-internal"
    }
    spec {
      action = "ALLOW"
      ip_prefix_list {
        prefixes = ["192.168.1.0/24"]
      }
    }
  }
}
```

Required: name, namespace. Rules contain spec with action (ALLOW/DENY) and match criteria.
Import: `terraform import f5xc_service_policy.example namespace/name`

### certificate

```terraform
resource "f5xc_certificate" "example" {
  name      = "example"
  namespace = "default"

  certificate_url = "string:///BASE64_ENCODED_CERT"
  private_key {
    blindfold_secret_info {
      location = "string:///BASE64_ENCODED_KEY"
    }
  }
}
```

Required: name, namespace, certificate_url, private_key.
Import: `terraform import f5xc_certificate.example namespace/name`

### rate_limiter_policy

```terraform
resource "f5xc_rate_limiter_policy" "example" {
  name      = "example"
  namespace = "default"

  rules {
    metadata {
      name = "rate-limit-rule"
    }
    spec {
      rate_limiter {
        total_number = 100
        unit         = "MINUTE"
      }
      any_ip = true
    }
  }
}
```

Required: name, namespace, rules.
Import: `terraform import f5xc_rate_limiter_policy.example namespace/name`

### api_definition

```terraform
resource "f5xc_api_definition" "example" {
  name      = "example"
  namespace = "default"

  swagger_specs = ["string:///BASE64_ENCODED_SPEC"]
}
```

Required: name, namespace.
Import: `terraform import f5xc_api_definition.example namespace/name`

### namespace

```terraform
resource "f5xc_namespace" "example" {
  name = "staging"
}
```

Required: name. Labels: add `labels = { key = "value" }`.
Import: `terraform import f5xc_namespace.example name`

## Advanced Lookup

For resources not listed above, or for full schema details (OneOf groups, server defaults, dependencies):

1. Read `xcsh://terraform/{resource-name}` for the complete resource documentation
2. Read `xcsh://terraform/` for the full category and resource listing
