# Shared review capture assessment — incomplete candidate evidence

Reproduce with `bun packages/coding-agent/scripts/capture-reviewed-actions.ts` from the repository
root. Each run creates a temporary bundle with 48 PNG/ANSI/text/metadata/Pango captures: review,
progress and failure at four dimensions, two themes and two symbol presets. These are controlled
component fixtures, not terminal walkthroughs or proof of actual saved state. Metadata includes
source revision/diff fingerprint, fixture, actions, expected outcomes and observed bounds.

Initial bundle: `/tmp/xcsh-review-captures-Qnd60f`, fingerprint
`fe4ae8ca1289bd44857faf25912d559bc5525bfcec63561e48880a887a943965`.
Direct inspection of `review-60x20-xcsh-dark-unicode.png` and
`failure-80x24-xcsh-light-ascii.png` found readable geometry but rejected failure semantics:
the title still said Review, and the error lacked distinct styling.

Repaired bundle: `/tmp/xcsh-review-captures-H97W8M`, fingerprint
`3fa43c42dc637c3cb727fae6a46e43ff11147b7908caa3bcb9387eb0569d439b`.
The two images below were directly inspected at full size after changing the heading to
Applying/Unresolved and giving errors error styling. Internal revision tokens were removed from
all rendered reviews but remain part of execution revalidation.

| Rubric | `progress-60x20-xcsh-dark-unicode.png` | `failure-80x24-xcsh-light-ascii.png` |
| --- | --- | --- |
| Hierarchy | Applying heading, session scope, operation, target/change and consequence clearly separated | Unresolved heading and red error distinguish result from initial consent |
| Self-description | Explicitly says work is in progress and cannot be interrupted | Explicitly says state may have changed and saving is unresolved |
| Density | Content fits with room below; consequence wraps readably | Content fits with room below; no internal JSON noise |
| Alignment | Text and rounded frame align at full size | ASCII edges, text and selection row align |
| Border/highlight integrity | Continuous visible frame; no selection shown during execution | Continuous frame and full-width Close selection |
| State semantics | No cancellation claim or navigation action during non-cancellable execution | Error emphasis and Unresolved title; no false success |
| Discoverability | Waiting behavior stated | Close and Retry both visible; Escape closes unresolved result |
| Reachable details | All fixture details visible without scrolling | All fixture details visible without scrolling |
| Recovery | Correctly waits for result; recovery is not offered prematurely | Retry is available and Close is selected initially |

Follow-up verdict: all 48 repaired images have now been directly inspected at full size and pass
the static rubric for these fixture states. Each capture's adjacent JSON records all nine rubric
judgments and explicitly limits acceptance to its synthetic fixture. The complete repaired bundle
is preserved in `reviewed-action-captures/`, including PNG, ANSI, text, Pango and provenance.
Across the matrix, wrapping remains readable, selection highlights and frame edges are intact,
and the 140-column terminals retain the 100-column frame maximum. No details overflow in these
short fixtures. Long/overflowing and stale reviews, command-specific details, loading, success,
warnings, real terminal rendering and interaction/recovery verification remain required.
This report does not establish complete-candidate acceptance or historical baseline comparison.

## Inspected image index

Every linked image has a `pass-static-fixture` verdict in its same-named JSON sidecar.

| Dimensions/theme/symbols | Review | Progress | Failure |
| --- | --- | --- | --- |
| 60x20 · xcsh-dark · unicode | [review](reviewed-action-captures/review-60x20-xcsh-dark-unicode.png) | [progress](reviewed-action-captures/progress-60x20-xcsh-dark-unicode.png) | [failure](reviewed-action-captures/failure-60x20-xcsh-dark-unicode.png) |
| 60x20 · xcsh-dark · ASCII | [review](reviewed-action-captures/review-60x20-xcsh-dark-ascii.png) | [progress](reviewed-action-captures/progress-60x20-xcsh-dark-ascii.png) | [failure](reviewed-action-captures/failure-60x20-xcsh-dark-ascii.png) |
| 60x20 · xcsh-light · unicode | [review](reviewed-action-captures/review-60x20-xcsh-light-unicode.png) | [progress](reviewed-action-captures/progress-60x20-xcsh-light-unicode.png) | [failure](reviewed-action-captures/failure-60x20-xcsh-light-unicode.png) |
| 60x20 · xcsh-light · ASCII | [review](reviewed-action-captures/review-60x20-xcsh-light-ascii.png) | [progress](reviewed-action-captures/progress-60x20-xcsh-light-ascii.png) | [failure](reviewed-action-captures/failure-60x20-xcsh-light-ascii.png) |
| 80x24 · xcsh-dark · unicode | [review](reviewed-action-captures/review-80x24-xcsh-dark-unicode.png) | [progress](reviewed-action-captures/progress-80x24-xcsh-dark-unicode.png) | [failure](reviewed-action-captures/failure-80x24-xcsh-dark-unicode.png) |
| 80x24 · xcsh-dark · ASCII | [review](reviewed-action-captures/review-80x24-xcsh-dark-ascii.png) | [progress](reviewed-action-captures/progress-80x24-xcsh-dark-ascii.png) | [failure](reviewed-action-captures/failure-80x24-xcsh-dark-ascii.png) |
| 80x24 · xcsh-light · unicode | [review](reviewed-action-captures/review-80x24-xcsh-light-unicode.png) | [progress](reviewed-action-captures/progress-80x24-xcsh-light-unicode.png) | [failure](reviewed-action-captures/failure-80x24-xcsh-light-unicode.png) |
| 80x24 · xcsh-light · ASCII | [review](reviewed-action-captures/review-80x24-xcsh-light-ascii.png) | [progress](reviewed-action-captures/progress-80x24-xcsh-light-ascii.png) | [failure](reviewed-action-captures/failure-80x24-xcsh-light-ascii.png) |
| 100x32 · xcsh-dark · unicode | [review](reviewed-action-captures/review-100x32-xcsh-dark-unicode.png) | [progress](reviewed-action-captures/progress-100x32-xcsh-dark-unicode.png) | [failure](reviewed-action-captures/failure-100x32-xcsh-dark-unicode.png) |
| 100x32 · xcsh-dark · ASCII | [review](reviewed-action-captures/review-100x32-xcsh-dark-ascii.png) | [progress](reviewed-action-captures/progress-100x32-xcsh-dark-ascii.png) | [failure](reviewed-action-captures/failure-100x32-xcsh-dark-ascii.png) |
| 100x32 · xcsh-light · unicode | [review](reviewed-action-captures/review-100x32-xcsh-light-unicode.png) | [progress](reviewed-action-captures/progress-100x32-xcsh-light-unicode.png) | [failure](reviewed-action-captures/failure-100x32-xcsh-light-unicode.png) |
| 100x32 · xcsh-light · ASCII | [review](reviewed-action-captures/review-100x32-xcsh-light-ascii.png) | [progress](reviewed-action-captures/progress-100x32-xcsh-light-ascii.png) | [failure](reviewed-action-captures/failure-100x32-xcsh-light-ascii.png) |
| 140x40 · xcsh-dark · unicode | [review](reviewed-action-captures/review-140x40-xcsh-dark-unicode.png) | [progress](reviewed-action-captures/progress-140x40-xcsh-dark-unicode.png) | [failure](reviewed-action-captures/failure-140x40-xcsh-dark-unicode.png) |
| 140x40 · xcsh-dark · ASCII | [review](reviewed-action-captures/review-140x40-xcsh-dark-ascii.png) | [progress](reviewed-action-captures/progress-140x40-xcsh-dark-ascii.png) | [failure](reviewed-action-captures/failure-140x40-xcsh-dark-ascii.png) |
| 140x40 · xcsh-light · unicode | [review](reviewed-action-captures/review-140x40-xcsh-light-unicode.png) | [progress](reviewed-action-captures/progress-140x40-xcsh-light-unicode.png) | [failure](reviewed-action-captures/failure-140x40-xcsh-light-unicode.png) |
| 140x40 · xcsh-light · ASCII | [review](reviewed-action-captures/review-140x40-xcsh-light-ascii.png) | [progress](reviewed-action-captures/progress-140x40-xcsh-light-ascii.png) | [failure](reviewed-action-captures/failure-140x40-xcsh-light-ascii.png) |
