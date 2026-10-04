# Bounded semantic development diagnostics

These diagnostics are exposed development evidence. They cannot qualify a release,
replace an independent held-out freeze, or establish installed xcsh model UAT.
The bundled immutable provider pin remains unchanged.

`semantic_development.py` runs the existing Ubuntu Codex CLI with ChatGPT login,
forces the OpenAI provider, and removes inherited OPENAI/LITELLM environment variables.
Only sanitized case IDs and prompts enter the candidate helper. Provider identity is
inferred from each question using the consumer resolver; expected answers remain in
parent-side scoring. Raw model traces stay in the task-local output directory.

Candidate pages use a 4 KiB serialized budget with a 1024-byte envelope reserve.
Continuation preserves complete candidate records. Descriptions are never clipped;
an indivisible record produces its exact read destination. Exact context reads use
16 KiB with the same reserve, preserving sections and fences or emitting a full-read
notice. Full exact reads retain their unlimited behavior. Parent links come from
exact indexed provider/schema destinations.

The encoder budgets JSON after it is escaped into command output.
The final audit measures complete serialized command-result events, including
command and metadata, and rejects oversized responses, helper bypasses, failed
commands, duplicate results and incomplete commands. A successful diagnostic still
requires manual semantic review for ambiguous and control cases. Candidate recall
is capped at the existing lexical top 20; this is an experiment, not production routing.

Run on Ubuntu from the consumer worktree:

```sh
python3 packages/coding-agent/bench/terraform-retrieval/semantic_development.py \
  --suite /absolute/exposed-suite/heldout.json \
  --index /absolute/unpublished-preview.sqlite \
  --assets /absolute/unpublished-preview-assets.json \
  --output /absolute/new-task-output \
  --ids A036,A070,A093,M001,C002 --regression
```

`enforced-diagnostic-*` preserves the prior three-case scope-supplied diagnostic.
It selected and read 3/3 leaves, but candidate packets used a 16 KiB allowance and
therefore did not satisfy production discovery limits. Original failed attempts
and receipts are retained unchanged.

`paginated-first-*` records 3/3 expected answerable selections, the correct role
clarification and unsupported-field rejection. Its audit failed on a raw missing-anchor
error. The initial review found additional audit/provenance weaknesses; its receipt
is preserved unchanged and cannot qualify the hardened harness.

The fixed development run passed command budgets and produced the five expected
semantic outcomes, but its source binding failed because the evaluator and generated
loader changed during execution. It remains ineligible and is preserved unchanged.

The stable run retained unchanged bound source and reproduced all five expected
semantic outcomes. Its original audit passed, but the final stricter re-audit rejects
one missing-anchor helper error. Both receipts are preserved. No successful
qualification is claimed. Final code requires canonical escaped command arguments,
valid exact-read queries and successful structured responses.

The expanded 11-case development run selected/read 6 of 9 answerable leaves,
asked a justified role clarification and rejected an unsupported field. Three
expected leaves were absent from its candidates. The strict audit rejected one
missing-anchor read. The property-only top-20 candidate recall was 128/140.
The development helper now supports bounded production search for model query
reformulation; search results do not establish completed exact leaf reads.

The nine-case search-fallback run selected and read every expected leaf, including
provider setup, imports and timeout guidance. Its original audit passed. Review
identified oversized-status, continuation, quoting and dependency-binding limits;
those findings remain attached and the result is development-only.
