# Autoresearch Ideas — Terraform Code Generation Quality

## Status: Active — L0 Quick Reference + Description Templates

33 runs, ~12 directions, 2 sessions. Baseline: 16.3 → Best: 57.4 (3.5x).
Mean with current config (expanded L0): ~56 (excluding one API outlier at 28.7).

## Committed Changes

1. Skill description: embedded all 9 resource templates with validated-correct HCL
2. Skill description: removed `xcsh://terraform/` URL hint to prevent unnecessary tool calls
3. Index fix: removed `non_validation_mode {}` from `api_definition` minimal_config
4. Index fix: removed wrong required fields (`burst_size`, `committed_information_rate`) from `rate_limiter_policy`
5. Resolver (L0): added "Quick Reference" section with all 9 resource templates to `renderL0`

## Key Mechanism

The L0 quick reference in the resolver is the breakthrough. When the model makes a tool call
to read `xcsh://terraform/`, it now gets compact templates alongside the category table. This
eliminates the need for a second tool call to read individual resource pages, allowing more
phrases to complete within the 120s benchmark timeout.

Before L0: mean ~32, best 39.3 (n=5). After L0: mean ~56, best 57.4 (n=4, excl outlier).
Effect size: Cohen's d ≈ 2.5 (very large).

## Remaining Gaps

### Provider-level failures (2-4 per run)

- `app_firewall` cross-ref on LB: model writes `app_firewall = "..."` instead of `app_firewall { name namespace }`
- HC import: model omits required fields (interval, healthy_threshold)
- cert import: model omits certificate_url
- Fix requires model understanding F5 XC block-style references (not string references)

### Timeout failures (5-8 per run)

- LB import: 0% historical pass rate (most complex template)
- SP create/update: intermittent timeout
- RLP create: intermittent timeout
- LB destroy: intermittent timeout

### Structural limits

- Plan phrase has no expect_resource — keyword score always 0. Max score = 0.5
- Troubleshoot phrases generate code but validation often fails (model uses wrong fields)
- 120s per-phrase timeout in benchmark script is not in scope to modify

## Ideas to Try

### Cross-resource reference hint (moderate impact)

Add to L0 quick ref: "Cross-resource references use blocks: app_firewall { name namespace }"
Risk: adds tokens to L0, may slow processing. Expected gain: ~2-3 points if it fixes LB update.

### Update-specific template examples (moderate impact)

Add brief update examples showing modified templates. Currently the model times out on
updates because it doesn't have a pattern to follow.

## Blocked

### Benchmark timeout (120s)

The 120s timeout is the hard constraint. ~20-30% of phrases still timeout.
The benchmark script is not in scope to modify.

### Provider schema issues

Some provider-level schema inconsistencies cause validation failures even with
correct-looking code. These require upstream fixes to terraform-provider-f5xc.
