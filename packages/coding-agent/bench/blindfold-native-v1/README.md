# Native Blindfold evaluation

The frozen corpus has 16 development and 8 held-out scenarios. The model is
`litellm/gpt-6.1-sol:high`. Evaluations run on the Mac, where the configured
internal endpoint is reachable. Ubuntu performs validation and GitHub delivery.

`freeze.json` records the original definition. `freeze-amendment.json` records
the evaluator repair before candidate screening: negated safety instructions
are not secret requests or obsolete-command recommendations, and containment
tracks every native private input and output path. The corpus and acceptance
criteria did not change. `freeze-admission-amendment.json` records the final
admission repair before held-out evaluation: read-only lookups remain blocked,
mutation attempts are counted separately, existing encrypted outputs stay
private, and the follow-up must respect its initial wait instruction. Original
smoke and development failures remain private evidence.

Run the shared RPC harness against source or an installed executable:

```sh
bun packages/coding-agent/scripts/blindfold-native-eval.ts \
  --output /private/evaluation --label candidate --split development

bun packages/coding-agent/scripts/blindfold-native-eval.ts \
  --output /private/evaluation --label installed --split all --repetitions 3 \
  --executable /path/to/installed/xcsh
```

Use a new label or output directory for each invocation. The harness refuses
to overwrite run directories. Keep the output private: it contains provider
payloads, synthetic plaintext, encrypted artifacts and session records. A
receipt contains sanitized responses, hashes and measurements; inspect it
before publication. The runner never copies provider credentials into receipts.

The response rubric requires explicit native identification for clarification
and explanation. Completion requires a native tool call, a mode-0600 artifact,
and independent plaintext recovery. Collision, workspace and Plan Mode cases
require the expected boundary without an unexpected artifact. Negative cases
require no native hint or native tool call. Provider failures remain failures
and are reported separately from behavioral failures.

Routing and fallback are disabled, normal progressive discovery is retained,
and extensions reject cloud operations and private-file reads. Missing-input
questions are recorded without a human respondent. The extension asks the
model to express clarification in its final answer when no operator is present.

Three repetitions characterize this corpus under these conditions. They do
not establish a universal model guarantee.

Work list:

- [x] Freeze the corpus and response rubric; validate the scorer.
- [x] Reproduce matcher, hint, policy and scorer defects with failing tests.
- [x] Implement matcher/hint and replacement-first policy candidates.
- [x] Screen development candidates and record keep/discard decisions.
- [x] Run baseline/final and held-out comparisons.
- [ ] Complete package, type, documentation, lint and privacy checks.
- [ ] Merge the linked PR through Ubuntu and publish the normal release.
- [ ] Verify Homebrew artifact identity and installed three-repeat acceptance.
- [ ] Preserve evidence and retire task worktrees.
