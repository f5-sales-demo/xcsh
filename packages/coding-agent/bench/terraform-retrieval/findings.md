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

Native baseline CI exposed a materialized generated loader committed without
its ignored SQLite file. Restored tracked null placeholder; normal builds generate
and verify the immutable assets. Workspace checks pass after this repair.
Four exact full-suite control retries still fail (2 invalid JSON,2 timeouts);
original failures and retries remain explicit, and no overall pass is claimed.

Separate24-case natural-language development set (14 answerable,8 ambiguous,
2 controls) produced source-only, outside the frozen qualification suite.
Unified path/description scorer experiment reaches8/14 first destinations and
11/14 top5 with provider-scoped queries roughly0.2-30ms. Kept in bench only;
not imported by production retrieval. Further accuracy work remains required.
Provider-name normalization for ordinary 'HTTP load balancer' wording is a
separate tested production repair. Local duplication check5.38% passes.

Qualification runner now rejects provider version/source/receipt drift and requires
explicit --regression for a changed index. Focused source-binding tests pass.
Static guidance keeps provider-specific support in the offline bundled corpus and
separates generic Terraform syntax from actual xcsh support. Workspace checks pass.

Control trace failures isolated to final agent_end aggregate writes ending at
about196KB before newline. A300KB print-mode regression reproduced returning
before the actual record write callback. Print mode now waits for each write.
14 print-mode regressions and workspace checks pass; exact control reruns pending.
Original failed traces are preserved; no trace cleanup or inferred pass is used.

JSON write repair exact retries:3/4 formerly failed controls now produce complete
valid traces and pass activation/claim checks. ctrl-disc-008 still times out.
Original invalid/truncated traces and first attempts remain retained. This repair
does not change failed accuracy qualification or establish installed release UAT.

## Deferred content loading

Broad-query ranking no longer carries Markdown and metadata through the window
ranking operation; only final selected rows load complete response content.
Paired24-prompt development evaluation,5 repetitions: all complete responses
identical; warm p95 before566.785ms,after138.183ms. This is development performance
evidence, not held-out qualification. Indexed facets and exact-read behavior stay
covered by focused snapshot and routing tests. Section ranker remains bench-only.

Deferred content loading full-suite post-analysis regression: discovery p95176.236ms,
complete response p95134.098ms; answerable18/140 (12.8571%),top5 26.4286%.
Not qualification. An alternative materialized grouped-ranking SQL preserved all24
development responses but increased paired p95139.290ms to177.158ms; rejected.
Window-ranking implementation retained. Accuracy and discovery latency remain open.

## Section selection development and qualification eligibility

Adaptive section selection now preserves indistinguishable sibling branches and
limits conflict hints to verified choice groups. Development integration reached
8/14 selected leaves,12/14top5,p95186.878ms. It was rejected and remains bench-only;
production retrieval keeps deferred-content ranking. No failed prototype shipped.

The independently audited frozen suite is explicitly ineligible for qualification.
An eligibility sidecar binds its unchanged suite digest and lists11 invalid unique
labels. Runner rejects qualification use, permits explicit --regression, and rejects
sidecar hash mismatch. New independently reviewed valid benchmark still required.

## Exact alias path identity

Alias ranking now normalizes snake_case query fields consistently with schema
segments, retains exact leaf identifiers and success/failure branch context, and
uses the indexed destination path for scalar aliases instead of its parent page.
Focused exact queries select Bot Defense success status and stateful custom-route
host rewrite; unspecified cookie nesting yields three meaningful sibling choices.
Full preceding alias-context regression top5 improves to30%, leaf accuracy remains
18/140; it is explicitly regression only. No qualification claim follows.

## Task-directed section routing

Root/minimal configuration requests now use exact fundamentals sections; import
and lifecycle timeout guidance remain dedicated task routes. Timeout schema field
requests no longer get replaced by usage guidance. Explicit facets and descendant
node constraints apply to task routes. Corpus checks select exact minimal app
firewall,certificate data-source root,and healthcheck timeout anchors; requesting
create/delete timeout fields returns both exact schema destinations.
461 internal-URL tests and workspace checks pass. Qualification remains unresolved.

Role inference now follows explicit provisioning/configuration versus lookup intent
and does not mistake existing resources for data sources. Generic informational
queries and competing roles stay undecided.462 internal-URL tests and workspace
checks pass; explicit Terraform activation remains unchanged. Regression only.

Task/role post-analysis regression:24/140 leaf selection (17.1429%),top5 31.4286%.
The scalar alias join query plan exposed a full terraform_destinations scan per
alias. Added provider_name/provider_type join predicates to use existing indexed
scope. Paired24development queries,5repetitions:complete responses identical;
p95 before359.770ms,after126.140ms. Accuracy qualification remains unresolved.

Scoped join full post-analysis regression:unchanged24/140 selected leaves,top5
31.4286%,discovery p95180.277ms,down from650.691ms in prior role regression.
Response bytes/destinations remain unchanged. Still fails latency/accuracy gate;
frozen suite remains ineligible.462URLtests+workspacechecks pass.

Scalar alias joins now bind schema_path encoded in verified schema anchors,
using destination primary-key lookup. Paired24development response parity passes,
p95140.241ms to127.061ms. Full regression remains24/140selected,31.4286%top5,
discovery181.660ms; no qualification.462URLtests+workspacechecks pass.

Duplicate aliases to one exact destination no longer cause false ambiguity or
repeated search entries. Provider roles and different anchors remain distinct.
462URLtests+workspacechecks pass. Full regression remains24/140 selected,
31.4286%top5,discovery183.127ms;no qualification claim.

Broad prose matching may omit absent ordinary words only when at least two indexed
terms remain; exact unsupported identifiers still fail closed. Retained terms try
AND before marked OR choices; broadened results never imply confident leaf selection.
463URLtests+workspacechecks pass. Regression top5 improves31.4286% to33.5714%,
leaf selection stays24/140;discovery187.902ms remains failed. Frozen labels unchanged.

## Descriptive action identity

Provider-name matching is scoped to explicit provider role. Descriptive action
verbs resolve against reviewed action names with operation and single/batch scope.
Action declaration/invocation requests route exact minimal configuration sections;
field/attribute requests retain schema routing. Corpus checks select cryptokey
delete,single-session terminate,site OS upgrade.464URLtests+workspacechecks pass.
Post-analysis regression33/140leaf(23.5714%),top5 40%,discovery203.052ms still
fails qualification. Frozen suite remains ineligible and unchanged.

Ancestor-description section experiment:14/14 development top5,11/14 first,
ranking p9572.446ms;not connected to production. Ambiguous certificate mode and
generic parent/field descriptions remain limitations.

Operation timeout requests now use indexed timeouts.create/read/update/delete
destinations;connection/request/TLS idle timeouts stay in property retrieval.
Initial creation and refresh phrasing tested;multiple operations return multiple
exact anchors. Explicit facets and descendant scope preserved. Qualification open.

## Dedicated ancestor section index experiment

Separate FTS5 index stores direct property schema paths,leaf/description terms and
ancestor descriptions without page Markdown.39,557 destinations,35,741,696bytes;
development14/14top5,11/14first,warm query p9540.210ms over5repetitions.
Two fixture builds are byte-identical and role/anchor regression passes.
Still experimental:ambiguous HTTPS mode,parent-vs-field and operation task intent
need selection handling. Not wired into production and no qualification claimed.

Dedicated ancestor index integration was evaluated on24development prompts:
baseline8/14correct selected leaves,p95148.141ms;candidate9/14,p95148.299ms.
The fallback index adds35.7MB and showed no latency gain. It was not promoted;
production source and reviewed pin restored. Prototype and full results
remain bench-only. No qualification expected destination was changed.

## Distinct fields within one document

BM25 candidates retain distinct anchors per file instead of collapsing all fields
to a single page result. A fixture reproduces hidden retry count/interval fields;
both exact anchors are now discoverable and same-destination aliases remain
deduplicated.466URLtests+workspacechecks pass. Post-analysis regression top5
42.8571%,selected32/140,p95202.774ms;qualification still failed,labels unchanged.

Bounded50-passage reranking experiment:11/14development first,13/14top5,
p95192.794ms. Integration test retains same-file fields and deterministic output.
Kept bench-only;no accuracy/latency qualification or production promotion.

Resource/data-source definition questions route exact fundamentals sections rather
than incidental fields. Field/attribute/path requests preserve property retrieval.
466URLtests+workspacechecks pass. Regression35/140selected(25%),45%top5,
discovery202.981ms remains failed;no qualification or modified frozen labels.

## Repeated schema branch selection guard

Candidates sharing the same leaf across different nesting branches require query
context identifying the top branch even when scores differ. Missing discovery
mode or cookie nesting yields choices; naming a lower-ranked alternative cannot
justify selecting the wrong top branch. Same-destination aliases remain merged.
467URLtests+workspacechecks pass;no qualification or benchmark expectation changes.

Corpus verification exposed that a ranked list may omit a real repeated branch.
Before confident selection,deep candidates now check verified sibling schema suffix
destinations in the same provider role,with all facets and descendant scope applied.
Discovery password without mode returns both top-level API discovery and per-app
ML discovery choices;exact branch queries still select correct leaves.
467URLtests+workspacechecks pass;qualification gate remains unresolved.

End-to-end sibling fixture verifies hidden repeated branches become choices and
category scoping excludes unrelated branch destinations. Two-segment repeated
suffix lookup covers shallower branch collisions;metadata/Markdown load only for
returned alternatives. Exact discovery-mode corpus queries remain selected leaves.
468URLtests+workspacechecks pass. This guards missing context,not validation rules.

## Published-corpus hybrid evaluation

Exact v12.2.0 property embeddings,embeddinggemma:300m model manifest
85462619ee721b466c5927d109d4cb765861907d5417b9109caebc4e614679f1.
Reciprocal rank fusion of lexical ancestor ranking and semantic property ranking
finds12/14development first,14/14top5. Local total p95205.993ms,
embedding193.829ms,ranking27.125ms. Two lexical misses improved,one lexical hit
regressed. Existing semantically ambiguous HTTPS-mode prompt still needs context.
Development only;no semantic path or model is bundled or promoted.

Hybrid script accepts explicit inputs and output,passes syntax/Ruff/format checks.
A second run reproduces identical rankings (12/14first,14/14top5);total p95186.257ms,
embedding178.272ms,ranking26.868ms. Semantic service stopped after task-only use.
No model/vector artifact is bundled and no held-out qualification is claimed.

## Hybrid timing scope correction

Prior hybrid p95 measured embedding plus semantic ranking/fusion only;lexical
candidate work was precomputed and excluded. Script now reports timing scope and
an explicitly estimated route with separate lexical time. Matrix single-thread
ranking reduces ranking p95 to9.840ms,but embedding181.677ms still exceeds target.
Measured semantic/fusion p95182.719ms;estimated combined route599.558ms.
12/14development first,14/14top5;no production route or qualification claim.

## Unique passage ranking optimization

Complete indexed corpus has no repeated path/anchor passage pairs. Removed
redundant ROW_NUMBER partition over that identity while preserving indexed BM25
order and post-ranking content loading. Paired24development complete responses
identical,p95148.863ms to117.772ms. Full post-analysis discovery p95149.606ms,
complete response143.319ms. Regression remains29/140leaf,45.7143%top5;no accuracy
qualification.468URLtests+workspacechecks pass. Phrase equality lookup experiment
did not improve full regression and was discarded before commit.


## Context guard and primary section rejection

Generic alias/schema context guard passed focused tests but reduced full published
regression leaf selection from29/140 to28/140. Top5 increased to48.5714%,
discovery p95159.098ms;the exact session ID development case regressed. Guard
removed before commit;receipt preserved. No production ranking change promoted.

Primary ancestor-section ranking evaluated separately on the unchanged,ineligible
suite reaches27/140first,53/140top5. Ranking-only p9537.061ms excludes complete
responses and index creation. It remains experimental and unshipped. This fuller
evaluation exposes provider-owner context loss and parent/field selection defects;
no qualification claim follows either experiment.


## Provider owner context

Multiple ordinary provider-name mentions now prefer one named owning context
introduced by in/under;explicit xcsh identifiers retain precedence. Comparisons
remain undecided. Red fixture reproduced protected-application/CDN confusion;
469 internal URL tests and workspace TypeScript checks pass after repair.
Full post-analysis regression:29/140selected,46.4286%top5,discovery150.848ms,
complete response144.425ms. Accuracy remains failed;this is no qualification.


## Provider credential setup routing

Provider authentication intent resolves maintained API token,P12,PEM or method
choice headings rather than the unrelated authentication resource. Caller facets
and node scope apply;unknown exact identifiers remain fail-closed. Indexed setup
reads avoid whole-corpus BM25. Red/green unsupported-identifier and integration
fixtures pass;471URLtests+workspacechecks pass. Final post-analysis regression
31/140selected,47.8571%top5,discovery149.240ms,complete144.068ms. Qualification
remains failed;the frozen suite is unchanged and ineligible.

IDF/path/leaf ranking experiment reaches11/14development first,13/14top5 with
indexed200candidate queries at33.658ms ranking p95. Full post-analysis regression
15/140first,56/140top5;requested-target parsing yields59/140top5. Only76/140
expected destinations enter the200candidate pool. Timing excludes response and
initial token preparation. Experiment remains unshipped;candidate recall needs
redesign. Pinned https_auto_cert description incorrectly repeats bring-your-own
certificate wording;source text remains unchanged and this inconsistency is
recorded rather than silently rewritten by the consumer.

A fresh independent source-only reviewer is auditing all200existing labels in
an isolated task workspace. No retrieval code/results or prior review findings
were supplied. This audit does not replace or modify the frozen benchmark and
cannot confer runtime qualification.
