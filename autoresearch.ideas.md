# Autoresearch Ideas — Terraform Code Generation Quality

## Status: Stable — All scope-file optimizations exhausted

182 runs, ~20 directions, 6 sessions.
Baseline: 16.3. Best: 63.3 (v18.86 era). v18.91 compiled binary best: 50.9.

## Committed Changes (on branch)

All changes are on `autoresearch/terraform-code-generation-quality-20260529`.

### Skill description (`.xcsh/skills/terraform-provider/SKILL.md`)

1. Embedded all 9 resource templates with terraform-validate-verified HCL
2. Per-resource import syntax lines (consolidating regresses)
3. Modifier hints: WAF block, healthcheck ref, TCP variant
4. Troubleshoot/destroy guidance lines (removing regresses — load-bearing)
5. "Output code first. Do not run terraform commands." directive
6. Skill body: "Generate code directly from templates. Do not read additional URLs."

### Resolver (`terraform-resolve.ts`)

7. L0 `renderL0`: added "Quick Reference" with all 9 resource templates — **single biggest improvement** (mean +22 points)
8. L0: cross-reference block syntax hint
9. L2 `renderL2`: compacted to description + required + top-level OneOf with `field {}` hint + config + import

### Index (`terraform-index.generated.ts`)

10. Removed `non_validation_mode {}` from `api_definition` minimal_config (reappears on regeneration — upstream issue)
11. Removed wrong required fields (`burst_size`, `committed_information_rate`) from `rate_limiter_policy`

Note: index is auto-generated. Fixes 10-11 must be reapplied after `bun --cwd=packages/coding-agent run generate-terraform-index`.

## Build Requirements

The resolver and index changes are compiled into the xcsh binary. To use them:

```bash
cd packages/coding-agent
bun run generate-build-info
bun run generate-terraform-index
# Reapply index fix:
python3 -c "
with open('src/internal-urls/terraform-index.generated.ts') as f: c = f.read()
c = c.replace('\\\\n\\\\n  non_validation_mode {}\\\\n}', '\\\\n}')
with open('src/internal-urls/terraform-index.generated.ts', 'w') as f: f.write(c)
"
bun build --compile --define PI_COMPILED=true --external mupdf --root ../.. ./src/cli.ts --outfile dist/xcsh
cp dist/xcsh /tmp/xcsh-override/xcsh
```

Then in `autoresearch.sh`:

```bash
export PATH="/tmp/xcsh-override:$PATH"
```

## Performance by xcsh Version

| Version | Runs | Mean | Best | Notes |
|---------|------|------|------|-------|
| v18.86 (pre-plugin-extraction) | 30-87 | **54** | **63.3** | All optimizations working, fast tool calls |
| v18.88-89 (source-built workaround) | 92-110 | 47 | 53.7 | `bun run` overhead ~7pts |
| v18.90-91 (compiled, with plugins) | 118-182 | ~37 | 50.9 | Plugin startup + xcsh_api interference |

## Remaining Gaps (outside scope)

### Model calls xcsh_api instead of generating code

v18.91 model non-deterministically calls xcsh_api to create resources on the F5 XC tenant
instead of generating terraform HCL. This wastes 20-30s per phrase and produces no code.
Adding "Do not call xcsh_api" to description was neutral (variance too high to measure).

### Plugin startup overhead

6 installed plugins load at startup. Removing plugin dir hangs the binary.
New `skill-creator` plugin adds context to system prompt.

### 120s benchmark timeout

Not in scope. Tight with v18.91 processing times.

## Tried and Failed (do not retry)

- Adding CRITICAL/directive language → regression (run 6)
- Consolidating import syntax to generic line → regression (run 15)
- Compact minimal_configs in index → severe regression (run 115, broke OneOf context)
- Removing troubleshoot/destroy lines → regression (run 56, lines are load-bearing)
- Adding import field reminders → neutral/regression (run 54)
- Adding no-variables hint to L0 → neutral (run 55)
- Standalone-block instruction in L0 → neutral (runs 111-114)
- Removing plugins dir during benchmark → binary hangs
- "Do not call xcsh_api" directive → neutral (runs 160-164, variance too high)
