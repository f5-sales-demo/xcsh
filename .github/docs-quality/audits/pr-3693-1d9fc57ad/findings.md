# PR #3693 semantic audit

## Critical

- The fixed-subject checker accepted 11 invalid isolated fixtures, including missing Git metadata and shallow history without the immutable legacy commit. The audited subject fails fail-closed baseline verification.

## High

- 171 concept mappings share headings with ten or more concepts; no individual concept prose is attributable at those destinations.
- The frozen tree exposes no source-defined pinned shared production builder, so the required generated-surface comparison cannot be reproduced from the audited subject.

## Result

- Concepts: 374 unique IDs; verdicts: partial=374.
- Pages: 62 English inventory pages reviewed.
- The audit artifact is complete; the audited subject does not pass.
