# Extension dialog visual review — incomplete candidate evidence

Synthetic fixtures only; no service contacted, credential captured, or persistent operation proved.
Initial captures `/tmp/xcsh-hook-captures-nI3h7H/{selector,input}.png` placed the question below
the controls. Direct image inspection rejected that hierarchy. The implementation now puts the
question above controls; long questions remain in pageable details.

Corrected set: `/tmp/xcsh-hook-captures-qFMon8`, 32 PNG/ANSI/text/metadata captures for input and
selection across all four specified sizes, two themes and two symbol presets. Fingerprint:
`3885e2f7cebe7a5ac1d9b13af45f9a9b9dbde4ac4254458c1f95bd6501855c74` (tracked diff plus shared
frame and capture renderer). Metadata records source revision, fixture and actions. These temporary
development files must be consolidated into the final evidence bundle.

Directly inspected full-size corrected images:

- [Selector, 60×20 dark Unicode](/tmp/xcsh-hook-captures-qFMon8/selector-60x20-xcsh-dark-unicode.png)
- [Input, 80×24 light ASCII](/tmp/xcsh-hook-captures-qFMon8/input-80x24-xcsh-light-ascii.png)

| Rubric | Judgment of these two images only |
| --- | --- |
| Hierarchy | Question precedes selection/input after repair. |
| Self-description | Extension input/selection and complete fixture question visible. |
| Density | Readable; no crowded controls at these sizes. |
| Alignment | Framed content and input gutter align. |
| Border/highlight integrity | Content stays enclosed; selected row has continuous fill. |
| State semantics | Idle choice/input clear; no success or persistence claim. |
| Discoverability | Search/input cursor and contextual Escape hint visible; remaps not visually checked. |
| Reachable details | Selected label shown fully; long unselected labels require selection. Paging needs broader checks. |
| Recovery | Escape covered by component tests; timeout/no-match screenshots still required. |

Remaining 30 corrected images are unexamined. Timeout, no-match, long-question paging, remapped
controls, actual-terminal interaction and all other required states remain outside this visual receipt.
No complete surface or candidate acceptance is claimed.

## Multiline editor representatives

Direct full-size inspection of [hook mode](/tmp/xcsh-editor-captures-3bu686/hook.png) and
[prompt mode](/tmp/xcsh-editor-captures-3bu686/prompt.png), both 60×20 dark Unicode, found readable
question-before-draft hierarchy, aligned wrapped draft lines, intact enclosure and contextual controls.
Fingerprint `bb3f0736a7f467ada5d609604ca5ae77b5893dff112c9f9d7490b7bf9d11dcc9` covers tracked diff
plus renderer. These are synthetic illustrations, not real-terminal or persistent-operation proof.

| Rubric | Judgment of the two editor representatives |
| --- | --- |
| Hierarchy | Question above draft; mode-specific control below. |
| Self-description | Extension editor title and full fixture question visible. |
| Density | Compact and readable at 60 columns. |
| Alignment | Continuation rows align with draft text, not its gutter. |
| Border/highlight integrity | Frame encloses all visible draft/control content. No selection row in this view. |
| State semantics | Editable draft, not a saved-success view. |
| Discoverability | Correct mode-specific newline/submit and external-editor hints. |
| Reachable details | Fixture text fits; long-question and viewport behavior tested separately, not visually judged here. |
| Recovery | Escape hint visible; error/rollback screens not captured. |

The first capture attempt failed on ANSI blink code 5. Renderer now samples the visible blink phase and
records that limitation in metadata; tests cover blink/reset without silently dropping cursor text.
Animation is not established by a PNG. Full editor matrix, failure states, terminal cursor fidelity and
external-editor recovery still require UAT. Capture metadata lacks source revision for these two early
representatives; they cannot satisfy the final provenance gate and need regeneration.
