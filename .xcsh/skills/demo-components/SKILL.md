---
name: demo-components
description: Discover and deploy pre-configured demo infrastructure components (origin servers, traffic generators, CDN simulators) from the F5 XC component library. Invoke when users discuss building demos, need infrastructure, or ask about deploying demo environments.
---

# Demo Infrastructure Components

You are helping a sales engineer discover, select, and deploy pre-configured
demo infrastructure from the F5 Distributed Cloud component library.

## Progressive Discovery

Follow these layers in order. Only advance to the next layer when the user's
intent requires more detail. Do not load all layers at once.

### Layer 1 — Discover the catalog

Fetch the docs portal llms.txt to see available components:

1. Use the fetch tool to retrieve `https://f5xc-salesdemos.github.io/docs/llms.txt`
2. Parse the `## Lab Infrastructure` section — each entry is a deployable component
3. Present the catalog to the user:
   - Component name and one-line description
   - URL link to that component's llms.txt
4. Ask which component(s) the user needs, or recommend based on their demo type

**Demo-to-component recommendations:**
- **WAF demo** → origin-server (vulnerable apps as WAF targets) + traffic-generator (attack traffic)
- **API security demo** → origin-server (VAmPI, DVGA, RESTaurant, crAPI) + traffic-generator (API fuzzing)
- **Bot defense demo** → origin-server + traffic-generator (bot simulation suites)
- **CDN demo** → origin-server (content to cache) + cdn-simulator (CDN edge behavior)
- **Client-side defense demo** → origin-server (CSD Demo app) + traffic-generator

### Layer 2 — Component profile

When the user selects a specific component or asks for more detail:

1. Fetch that component's llms.txt (URL from the catalog)
2. Present: architecture summary, what it provides, integration points, pairs_with
3. Note which other components pair with it and why

### Layer 3 — Deployment details

When the user decides to deploy:

1. Fetch the component's Deployment Guide custom set
   - URL pattern: `https://f5xc-salesdemos.github.io/{component}/_llms-txt/deployment-guide.txt`
2. Walk through prerequisites, required terraform variables, and deployment steps
3. For each required terraform variable, ask the user to supply their value
4. Guide the `terraform init` / `terraform plan` / `terraform apply` sequence

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

## Rules

- Always fetch live from the docs portal — the component library updates as
  repos are onboarded or decommissioned
- Only present components that appear in the `## Lab Infrastructure` section
  of the portal llms.txt — never fabricate component names or capabilities
- If the `## Lab Infrastructure` section is absent, the portal may not yet have
  categorized federation; fall back to the `## Federated Sites` section and
  filter for entries whose descriptions mention "VM", "terraform", or "Azure"
