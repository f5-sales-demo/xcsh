# Proposed clarification qualification protocol

Status: proposal requiring independent review before a new benchmark freeze.

An answerable case retains the original gate: the first selected exact leaf must match the source-reviewed destination, and that destination must appear within the first five retrieval candidates. Hierarchy cannot substitute for a uniquely answerable leaf.

For an ambiguous case with more than five equivalent destinations, the independent benchmark author may declare a bounded decision tree using verified role and schema-node
destinations. Every expected leaf must be covered exactly by the tree. Each decision presents at most five meaningful alternatives; the reviewer must establish that the omitted
information is genuinely required to choose a branch. Alternatives sharing only a generic field name do not qualify as equivalent.

The evaluator must verify the initial response is undecided, every returned refinement preserves query and caller filters, each refinement stays within its selected role/node
descendants, every decision response fits 4 KiB, and every branch has a finite exact-read destination. Following all permitted branches for evaluation must cover every expected
leaf without unsupported leaves, invalid anchors, loops or omissions. A leaf can become selected after the evaluator deliberately supplies the reviewed missing branch, but cannot
be selected before that information is supplied.

Flat ambiguity cases with at most five exact alternatives retain the existing scoring rule. The evaluator must report initial candidate coverage and complete continuation coverage
separately. Latency measures complete responses per tool call over five repetitions; the total explored decision tree time and tool calls are reported separately. Model UAT must
assess the actual question asked of the user, rather than treating evaluator traversal as a user answer.

This protocol cannot be applied retroactively to claim qualification on any exposed suite. The author and verifier must freeze the decision tree, source identities and scoring
protocol before the new held-out run. The retained gate is at least 95 percent correct leaf selection or justified clarification overall and at least 95 percent answerable leaf
selection, with zero unsupported-field or false live-apply claims.
