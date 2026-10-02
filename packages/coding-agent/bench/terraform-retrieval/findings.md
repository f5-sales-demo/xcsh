# Progressive Terraform retrieval qualification

## First frozen preview run

Provider metadata working tree dfe77edf0b, index e95b4189335e7958c02491dc7dcf00a4491fba3f913418816e3d30617ffcedcf. This
preview index carries baseline provenance only and is not a release artifact.

200 frozen cases (140 answerable, 40 ambiguous, 20 controls), 52 depth8+ cases; 40 model subset frozen separately. Suite
hash 7d768dd1eaede2033d2df9a0e43b215e2ac0990a5d099c4a6be91bc23caf4430.

First untouched frozen run: answerable leaf accuracy 78.5714%, top5 80%, scored retrieval accuracy 78.4211%; model-only
controls unscored. Ubuntu warm p95 152.755 ms; Mac 164.020 ms, five repetitions per activated query (970 responses). All
discovery bytes <=3708. Rankings and anchors identical across platforms. This FAILED qualification.

## Failure analysis

Exact provider mention was confused with provider names embedded in deep paths; query framing words collided with real
fields such as where and id; task paraphrases did not select import/timeout pages; unspecified provider roles produced
incomplete choices. Semantic retrieval cannot by itself establish exact identifier precedence or documented
destinations. Fix these deterministic resolver errors before deciding whether semantic/hybrid retrieval is justified.

## Post-analysis regression

Answerable 96.4286%, top5 96.4286%, scored 95.2632%, Ubuntu p95 181.050 ms. This is post-analysis regression, not
held-out qualification. It still FAILED latency. Remaining misses are everyday backend-server/certificate/advanced-Bot
phrasing and precise successful-login status leaves.

No overall/model accuracy, supported-HCL result, false-live-apply pass or installed acceptance is claimed. Offline
installed UAT and 40-model trace qualification remain outstanding.

## Compact indexed precision regression

Index f284ffe3b44f49e8f1718288223d5e923e62e8b0affac82989f2500f5b6504ab; SQLite 892,760,064 bytes, gzip 77,824,448 bytes.
Two generation runs match both digests. Answerable leaf accuracy/top5 98.5714%; scored retrieval 98.9474%. Ubuntu warm
p95 105.174 ms; Mac 98.132 ms. Five repetitions, 970 complete search responses per host. Context sections/fences remain
complete; maximum discovery 2,878 bytes. Two prompts remain failures (existing-certificate and advanced Bot Defense
paraphrases). This is regression evidence after examining the first frozen run; no renewed held-out qualification is
claimed.

Broader internal URL suite: 454 tests pass after required source-matched native preparation. Typecheck, bundle check and
prompt formatting checks pass. Installed model route confirmed openai-codex/gpt-6.1-sol on xcsh 22.7.2; candidate
installed 40-prompt UAT is pending provider publication.

## Disjoint v2 first run

A second frozen set has no prior prompt or answerable-destination overlap. It passes 140/140 answerable destinations but
fails all 40 role ambiguities because navigation wording collides with read timeout fields. Scored accuracy 78.9474%;
first-run p95 Ubuntu12.897ms/Mac8.271ms. This FAILED qualification and is preserved. Navigation detection repair
regression: 139/140 answerable and 40/40 ambiguous; scored99.4737%, Ubuntu97.180ms. This remains post-analysis
regression.

## Complete response budget audit

All 18,953 documents and their property/section context destinations were read through the repository resolver. Zero
errors; maximum hint4,084bytes (<=4096), maximum context11,321bytes (<=16384). Invalid after/cursor combinations
rejected; compact prerequisite hints preserve destination links.

## Latest metadata preview

Provider1beecf718d adds list-object prerequisites/conflicts and word-boundary summaries. Preview
index389bdb4dfe12947d7f079e3d7c71f2ec5aa94dffdbd845ffb862a82997d85490; 903,282,688 SQLite bytes / 78,346,730 gzip bytes.
Original-suite regression: 98.5714% answerable leaf, 99.2857% top5, scored98.9474%; Ubuntu p95144.740ms, Mac106.572ms;
identical rankings/anchors, maximum discovery2,904bytes. Complete 18,953-document hint/context audit passes,
max4,084/11,321bytes. Both untouched frozen first runs remain failures; no overall or installed qualification claimed.

## Candidate model traces

A compiled unpublished candidate ran the frozen 40-model subset with openai-codex/gpt-6.1-sol.
Manual trace review and exact retries: 39/40 pass; 27/28 answerable pass; no unsupported-field
or false-live-apply claims found. The certificate expected destination remains failed. Two
trace-format retries and two negation/wording grader false positives are recorded. Most
answerable cases used two or three reads after static query-preservation guidance. No HCL
was emitted; supported-field drafting acceptance and released-artifact rerun remain required.

## Candidate HCL drafting

Synthetic namespace and origin-pool drafts use only exact documented schema paths.
The certificate case identifies named-object and PEM/secret-reference choices and asks
for storage location before drafting. Exact citations and trace/HCL hashes are recorded.
No Terraform execution occurred, and all cases disclose the unpublished preview.
These candidate checks require a final immutable-release rerun.

## Offline compiled candidate smoke

Ubuntu `sudo -n unshare --net` compiled-candidate Terraform smoke passes inventory,
filtered search, bounded hint/facets, explicit anchor, deep leaf and missing-query checks.
Marker: XCSH_TERRAFORM_DOCUMENTATION_SMOKE_OK. This is an unpublished candidate;
final Homebrew and Ubuntu published-artifact checks remain pending.

## Final disjoint v3 qualification failure

Third disjoint untouched set: 140/140 answerable destinations and top5 pass; 34
role-choice prompts fail because mentioning resource and data source was interpreted
as selecting the latter. Scored82.1053%; qualification FAILED. Subsequent inference
repair preserves competing roles, with a focused regression test. No replacement
held-out suite will be claimed in this iteration; final qualified accuracy remains open.

## V3 repair regression

After preserving competing provider roles, v3 regression passes all 190 scored
retrieval cases, including 140/140 answerable and 40/40 ambiguous cases. Ubuntu
warm p95101.998ms. This is post-analysis regression, not untouched qualification;
the v3 first-run failure remains authoritative for the held-out gate.

## Separate semantic experiment

embeddinggemma:300m document-summary embeddings (768 dimensions, model manifest
85462619ee721b466c5927d109d4cb765861907d5417b9109caebc4e614679f1) indexed 18,267 pages.
Development-only top1 0/6, top5 1/6; warm p95240.378ms; vector storage56,116,352bytes;
embedding generation157.333seconds. This experiment excludes direct-property passages
and is too narrow to disqualify hybrid retrieval generally. It provides no basis to
ship semantic retrieval; passage/hybrid evaluation remains separate from frozen suites.

## Separate property-passage semantic experiment

39,557 direct-property passages, 768 dimensions, embeddinggemma:300m, same model
manifest as the document experiment. Six development cases: exact destination
top1 2/6 and top5 3/6; warm p95 228.934 ms including local query embedding and
dense ranking. Generation 280.386 seconds; vector storage 121,519,232 bytes.
The receipt now distinguishes document-only scoring from exact anchor scoring.
This is a known-development experiment with no confidence/clarification route,
not qualification and not a basis for shipping a semantic retrieval path.

## Retained qualification gate and independent review

The user retained the >=95% qualification gate. All three untouched synthetic
suites remain failed; repairs and candidate UAT do not satisfy release acceptance.
PR #4687 stays draft. A fresh Antigravity author workspace receives documentation
and benchmark requirements only, followed by a separate verifier session. Neither
receives retrieval code or prior results. Candidate authoring is not freezing or
qualification. Final freeze binds the published immutable documentation snapshot;
review must verify coverage, exact anchors, depth, ambiguity and source evidence.

## Independent suite scoring before freeze

The new suite requires every permitted ambiguity destination within the top five,
rather than accepting a single destination as adequate clarification evidence.
Exact answerable selection still requires the first destination and exact anchor.
Leaf context read bytes now count in total response bytes. Two focused scorer
tests pass. These rules were set before freezing or running the independent suite.
No prior benchmark qualification result is recalculated or upgraded.

Before the independent freeze, latency measurement also repeats every selected
context read five times and reports discovery, context, complete response and
combined route p95 separately. Complete context bytes are included in totals.
Workspace type/lint checks and scorer tests pass; no held-out run has occurred.

Before the independent freeze, model trace scoring also requires exact anchored
reads rather than accepting a parent-file read. Automated trace accuracy is
explicitly provisional; manual clarification and HCL review remain required,
and qualification_passed remains false until combined acceptance evidence exists.
Python syntax, Ruff and formatting checks pass.

## Independently reviewed published-source first run

Provider v12.2.0, immutable documentation-v12.2.0, source b53aad4062cc,
receipt f735dbfcb84536210bd396ec0d54477e662e005ad0b37b9e35f962fce5e79693.
Suite6deb592af8737b3d91085b5e28c939d8d928f5eb5243ae833d5ee754bb348d6a;
140/40/20,56 depth8+, fresh source-only author and verifier approval.

Untouched first run FAILED:12/140 answerable (8.5714%), top5 21.4286%;
0/40 complete ambiguity choices,6/6 unsupported fields,14 model controls
unscored. Ubuntu discovery p95774.967ms, Mac1132.098ms; complete-response
p95677.771/999.056ms. Rank/anchor/results and response bytes match exactly.
Discovery<=4065bytes, context<=6472bytes. Budgets pass; accuracy and latency fail.

Early failures show role confusion, exact resource context lost to generic schema
words, BM25 selecting incomplete branch choices, and broad-query scan latency.
The approved suite remains unchanged. No repaired run will be called held-out
qualification. Consumer PR #4687 remains draft under the retained >=95% gate.

Published snapshot regressions:457 internal-URL tests pass. All18,954 document
hint/context views pass (37,908 responses), max4084/15155bytes.
Compiled candidate Terraform smoke passes with network disabled on Ubuntu and Mac.
These are candidate artifact checks, not released Homebrew/Ubuntu acceptance.
Metadata-v1 snapshot asset digests match exact-tag candidate; Linux repeated index
builds match; Mac logical tables and FTS hashes match but SQLite storage bytes differ.

Published-provider model candidate:40 frozen prompts completed; automated trace
pass27/40 (16/28 answerable,8/8 ambiguous,3/4 controls). Exact leaf-read failures
remain; two negated live-apply regex false positives explicitly reviewed.
11 HCL fences parse;54 provider paths verified supported; completeness of partial
snippets not claimed. No false live-apply claim found in manual trace review.
The custom-provider-function control used external generic syntax instead of
the documented absence. Consumer remains unqualified.

General first-run failure repairs preserve full exact provider mentions and
concrete HCL resource intent, and stop role-choice fallback overwriting existing
precise candidates.458 internal-URL tests pass. Any frozen-suite rerun after
these repairs is regression only; untouched first-run failure stays authoritative.

Identity repair regression remains insufficient:16/140 answerable (11.4286%),
top5 25.7143%, discovery p95588.721ms. This is post-analysis regression only.

Separate direct-section FTS5 experiment on39,557 destinations scored only1/6
known development cases first/top5, with roughly54-59ms queries. It is faster
than the broad passage route but insufficiently accurate; no path is shipped.
Both standalone semantic and simple section-BM25 experiments fail to establish
the required precision. Further retrieval redesign and fresh independent
qualification remain required; PR #4687 remains draft.

## Independent collision-label audit

A fresh source-only reviewer rechecked11 suspected sibling-path collisions and
found answerable-label defects. Discovery mode and cookie nesting context were
missing in several prompts, so the intended exact destination was not unique.
The frozen suite and first-run failure remain unchanged. This suite cannot
qualify a future release; label-defect review does not retroactively pass retrieval.
A new valid independently reviewed suite remains required after retrieval redesign.

## Deterministic provenance repair

Container CI reproduced index digest drift when formatting reordered pin JSON.
Index provenance is now recursively key-sorted; a regression first failed then
passed when building with reversed equivalent pin keys. Two complete published
index builds now match after formatting, sha067e04c33404d29a13318624bcc768947673a4732c504d4e43754f69baa11ade.
Receipt payloads compacted without dropping records or changing frozen prompts.
