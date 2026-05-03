---
name: demo-components
description: Discover and deploy pre-configured demo infrastructure components (origin servers, traffic generators, CDN simulators) from the demo-resources catalog. Invoke when users discuss building demos, need infrastructure, or ask about deploying demo environments.
---

# Demo Infrastructure Components

You are helping a sales engineer discover, select, and deploy pre-configured
demo infrastructure from the F5 Distributed Cloud component catalog.

## Progressive Discovery

Follow these layers in order. Only advance to the next layer when the user's
intent requires more detail. Do not load all layers at once.

### Layer 1 — Discover the catalog

Fetch the demo-resources llms.txt to see available components:

1. Use the fetch tool to retrieve `https://f5xc-salesdemos.github.io/demo-resources/llms.txt`
2. Parse the `## Sections` for component profile pages and `## Federated Sites`
   for links to each component's full documentation
3. Present the catalog to the user:
   - Component name and one-line description
   - Link to more details
4. Ask which component(s) the user needs, or recommend based on their demo type

**Demo-to-component recommendations:**

- **WAF demo** — origin-server (vulnerable apps as WAF targets) + traffic-generator (attack traffic)
- **API security demo** — origin-server (VAmPI, DVGA, RESTaurant, crAPI) + traffic-generator (API fuzzing)
- **Bot defense demo** — origin-server + traffic-generator (bot simulation suites)
- **CDN demo** — origin-server (content to cache) + cdn-simulator (CDN edge behavior)
- **Client-side defense demo** — origin-server (CSD Demo app) + traffic-generator

### Layer 2 — Component profile

When the user selects a specific component or asks for more detail:

1. Fetch the Component Catalog custom set for all profiles in one request:
   `https://f5xc-salesdemos.github.io/demo-resources/_llms-txt/component-catalog.txt`
2. Present the selected component's architecture, installed software, terraform
   variables, and integration notes
3. Note which other components pair with it

### Layer 3 — Deployment details

When the user decides to deploy:

1. Fetch the deployment guide custom set directly — do NOT fetch the component's
   llms.txt first (it is just a table of contents pointing here):
   `https://f5xc-salesdemos.github.io/{component}/_llms-txt/deployment.txt`
2. Walk through prerequisites, terraform variables, and deployment steps
3. For each required terraform variable, ask the user for their value.
   All components share these standard variables:
   - `subscription_id` (required) — Azure subscription ID
   - `deployer` (optional, auto-resolved from Azure AD) — override for CI/service principals
   - `location` (default: `eastus2`) — Azure region
   - `environment` (default: `lab`) — label used in resource group naming
   - `vm_size`, `disk_size_gb`, `admin_username`, `ssh_public_key_path`, `tags` — compute and tagging
4. Guide the deployment: copy `terraform.tfvars.example` → `terraform.tfvars`,
   fill in required values, then `terraform init` / `terraform plan` / `terraform apply`
5. After apply, all components publish 15 standard outputs including `deployer`,
   `public_ip`, `private_ip`, `ssh_command`, `resource_group_name`, `vm_name`,
   `nsg_name`, `vnet_name`, `subnet_id`, `component`, and `environment` — plus
   component-specific outputs (app URLs, health checks, etc.)

## Session Caching

Cache fetched content within this session. If the user asks about a component
you already fetched, reuse the cached content rather than re-fetching.

## Multi-Component Architectures

When a demo requires multiple components:

1. Present the full architecture showing how components connect to each other
   and to the F5 XC platform
2. Note deployment order — typically: origin-server first, then traffic-generator
   pointing `target_fqdn` at the F5 XC load balancer FQDN
3. Offer to walk through each component's deployment in sequence
4. Each component's `component-manifest.json` (schema v2) describes its
   required/optional inputs, standard outputs, and component-specific outputs
   in a machine-readable format — use this to wire components together
   (e.g., origin-server's `public_ip` output feeds cdn-simulator's `origin_server` input)

## Rules

- Always fetch live from demo-resources — the catalog updates as new
  components are onboarded or decommissioned
- Only present components that appear in the demo-resources llms.txt —
  never fabricate component names or capabilities
- Components are use-case-agnostic building blocks; recommend them based
  on what the user's demo needs, but describe them by what they ARE, not
  by which demo they belong to
- Do NOT fetch docs/llms.txt (the main portal) for component information —
  this skill is the single entry point; the portal duplicates component
  listings and causes redundant fetches
- Do NOT fetch individual component llms.txt files (e.g., origin-server/llms.txt)
  as an intermediate step — go directly to the deployment-guide custom set
  when the user wants to deploy
- Follow the layer sequence strictly: demo-resources/llms.txt → component-catalog.txt
  → deployment-guide.txt. Maximum 3 fetches for a full discovery-to-deploy flow
