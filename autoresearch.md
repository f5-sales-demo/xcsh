# Autoresearch

## Goal
CRUD-verify the http_loadbalancer resource against the live F5 XC API (tenant: nferreira, namespace: r-mordasiewicz). Document all server-applied defaults, validate oneOf group boundaries, and probe field constraints. This is the capstone of the HTTP LB dependency audit (#332).

## Benchmark
- command: bash autoresearch.sh
- primary metric: verified_items
- metric unit:
- direction: higher
- secondary metrics: defaults_found, crud_pass

## Files in Scope
- autoresearch.sh
- autoresearch.md

## Off Limits
- packages/

## Constraints
- xcsh_api calls must be sequential (one per turn, shared TLS connection)
- metadata.name must be DNS-1035: ^[a-z]([-a-z0-9]*[a-z0-9])?$
- Test names use xcsh-uat-* prefix
- PUT returns {} (empty body) on replace
- POST returns full created object with system_metadata
- Do not modify xcsh source code — only api-specs-enriched config files
- Origin pool must exist before HTTP LB can reference it

## Preflight
- F5XC_API_URL, F5XC_API_TOKEN, F5XC_NAMESPACE env vars must be set
- jq must be available for JSON parsing
- curl must be available for API calls
- Comparability invariant: same API tenant (nferreira), same namespace (r-mordasiewicz)

## Baseline
- metric: 0
- notes: No items verified yet. Starting from catalog min config.

## Current best
- metric: 0
- why it won: N/A

## What's Been Tried
- Phase 1: All 13 dependency resources CRUD-verified. 3 catalog bugs fixed (#350, #351, #352).
