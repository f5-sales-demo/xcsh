# Settings capture repair: representative visual inspection

Status: **partial evidence; complete-candidate acceptance has not passed.**

These are deterministic component fixtures, not real-terminal captures or proof of persistence.
Each capture has PNG, ANSI, text, Pango source and JSON metadata (actions, expected/observed layout,
fixture identity, revision, source/diff fingerprint, theme, symbols and dimensions).

## Initial inspection and repair

Initial capture directory: `/tmp/xcsh-settings-captures-oywq9A` (64 captures, four principal screens
across all 16 combinations). Fingerprint:
`717abdeffced094e357af5730b2c7889054d02bbbc687a54eb7a0571226bf1c8`.

Directly inspected full-size images:

- `settings-browse-60x20-xcsh-dark-unicode.png`
- `settings-review-100x32-xcsh-dark-unicode.png`
- `plugin-settings-browse-60x20-xcsh-dark-unicode.png`
- `plugin-settings-detail-80x24-xcsh-light-ascii.png`

The plugin browse/detail images failed self-description and density: a serialized selection identity
was repeated as visible detail text, and `__enabled__` appeared as a user-facing label. Inspection also
prompted a code check that found missing unsaved-draft review controls on plugin screens. The browser
now accepts presentation-specific detail text without changing stable selection identity, and the
plugin screens receive the shared draft summary/review shortcut. Interaction tests remain separate
from visual judgment.

## Recapture and direct image judgment

Recapture directory: `/tmp/xcsh-settings-captures-XNc4FX` (64 captures). Fingerprint:
`cc174d38f5c88582b7ae426248e4cbb26359abd9a2b7686b5b3597cf793e7927`.

Directly inspected corrected images:

- `/tmp/xcsh-settings-captures-XNc4FX/plugin-settings-browse-60x20-xcsh-dark-unicode.png`
- `/tmp/xcsh-settings-captures-XNc4FX/plugin-settings-detail-80x24-xcsh-light-ascii.png`

| Rubric | Observed judgment for these two images only |
| --- | --- |
| Hierarchy | Pass: title, scope, search, choices and details are separated clearly. |
| Self-description | Pass for shown state: user defaults and installed version/path are identified; internal IDs are no longer displayed. |
| Density | Pass: synthetic description is readable without repeated identity encoding. |
| Alignment | Pass: values align and wrapped details stay inside gutters. |
| Border/highlight integrity | Pass: continuous selection background and intact Unicode/ASCII borders. |
| State semantics | Pass for shown browse state: enabled state and masked secret are distinct. Pending/failure states not covered by these images. |
| Discoverability | Pass for shown navigation: search and section control visible. Draft review shortcut still needs its own state capture. |
| Reachable details | All details in these fixtures are visible; overflow interaction needs separate evidence. |
| Recovery | Not established by browse images; error/loading/retry captures remain required. |

The other 62 recaptured images have **not** been directly inspected and are not visually accepted.
The JSON metadata intentionally retains `visualVerdict: unexamined`; this document records the narrow
direct-inspection evidence, not a full matrix verdict. Temporary paths must be consolidated into the
final candidate evidence bundle before publication. Real-terminal UAT, all applicable states and
complete screenshot-linked verdicts remain required.

## Capture fidelity corrections

`terminal-capture.ts` handles standard 16-colour, indexed 256-colour and RGB SGR styles, including
backgrounds, inversion and text attributes. Unsupported SGR codes fail capture rather than being
silently ignored. Tests cover indexed/RGB colours, resets, inversion, escaping and rejected codes.
The settings harness selects named themes and verifies the active theme; applying a symbol preset
to an in-memory theme could otherwise fall back to dark while retaining a light filename. The old
pilot capture tool still needs migration to the corrected helper and baseline recapture.
