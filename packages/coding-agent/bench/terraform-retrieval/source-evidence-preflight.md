# Source evidence preflight for future qualification

A future eligible freeze must include `case-source-evidence.json` and its SHA-256 in `freeze.files`.
The independently authored review must bind that digest as `source_evidence_sha256`; its own digest
must match `freeze.independent_review_sha256`. The existing independently reviewed suite and model
activation checks still apply. Exposed suites continue to run only as regressions.

Each case supplies `answer_sections` with exact internal document/anchor URIs and quotes from the
complete returned sections. Every expected destination needs its own evidence. Additional child
sections belong in the answer evidence when they are needed to draft supported values. An expected
block section cannot claim a quote that exists only at a child anchor or elsewhere on the page.

`peer_adjudications` account for same-provider, same-leaf, identical-description peers across all
roles and schema branches. Each entry supplies its URI, exact prompt and source-section quotes,
`permitted` or `excluded`, and the review reason. Permitted peers must occur in the frozen expected
set; excluded peers cannot be expected destinations. Other semantic peers also need independent
review even when their wording differs; the mechanical inventory cannot identify every ambiguity.

These checks run against the pinned index before any scored retrieval. They validate digest binding,
coverage, destinations, and quote existence. They do not certify semantic uniqueness, whether a
clarification is genuinely necessary, or reviewer independence. Those judgments remain required
before freeze. No exposed suite is relabeled or made eligible by this change.
