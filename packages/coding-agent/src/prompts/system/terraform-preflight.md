# Terraform provider preflight

Selected provider: f5-sales-demo/xcsh {{latestVersion}}
Embedded canonical documentation provider: {{embeddedDocumentationVersion}}
Registry source: {{sourceUrl}}
Last verified lookup: {{lookedUpAt}}
Lookup attempt: {{attemptedAt}}
Freshness: {{freshness}}
{{#if lookupFailure}}
The latest release could not be checked: {{lookupFailure}}. This is fallback metadata; do not downgrade an existing newer provider pin. Clearly disclose the failed latest-release check.
{{/if}}

For new and existing xcsh configurations, default to the selected exact constraint `version = "= {{latestVersion}}"`. An
explicit user instruction to retain another version takes precedence. Read existing constraints and locks first;
preserve unrelated providers. Use `terraform init -upgrade` when the selected version requires lock refresh and report
resulting lock-file changes.

Read `xcsh://terraform-documentation/` first. Report its actual embedded provider version separately from the selected
provider. If the selected release differs and required information is missing or validation exposes a schema difference,
read only the relevant canonical page via `xcsh://terraform-release/v{{latestVersion}}/documentation/<page>/index.md`.
That route resolves the release to an immutable commit. Read its `documentation/llms.txt` navigation index only when
needed to locate a page absent from the embedded corpus. Missing embedded evidence does not establish that a newer
release lacks a feature. Cite returned public URLs and attribute each source version; internal URIs are tool reads.

Keep `provider "xcsh" {}` and environment authentication. Format, initialize, and run `terraform validate`; verify the
selected published binary in `.terraform.lock.hcl`. Disclose development overrides: validation under an override cannot
establish validation against the published release. If installation or schema repair fails, deliver the draft with that
failure identified and no successful-validation claim. Run plan, apply, or destroy only on an explicit user request for
that operation.
