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


## Grammatical task identity and experiment scope correction

Task identity now recognizes imports/importing,creating/deploying and PKCS#12
without replacing action attribute queries with usage pages. Provider environment
credential requests target argument-reference. Red fixtures reproduced parser
misses;472URLtests+workspacechecks pass. Post-analysis regression35/140selected,
49.2857%top5,discovery148.570ms,complete144.676ms;qualification remains failed.

Property-ranking diagnostics previously compared a property-only index against all
140answerable cases. Correct scope:88property cases,76within200candidates,59top5;
52task pages cannot be returned by that experimental index. Scoring every scoped
property yields the same59top5at249.407ms ranking p95. Increasing candidate volume
alone is not sufficient. This correction does not change production or qualification.

## Completed source-label audit and CI repair

Fresh independent source-only audit returned SUCCESS with200unique case records,
verdict label-defects. It rejects3answerable block/property labels and6ambiguity
role labels,but approves11cases rejected by the earlier collision audit. Both
reviews are preserved;fresh20case adjudication remains active. Frozen prompts,
first results,and eligibility status are unchanged. No runtime qualification follows.

Exact identifier precedence safeguard was evaluated and discarded:full regression
results unchanged,and the proposed integration fixture also passed the baseline.
No unsupported change was promoted from this experiment.

CI spelling fragments rewritten without behavior changes;repeated snapshot test
repository setup extracted into one fixture helper. Complete task-owned regression
results are now losslessly gzip-compressed with byte counts and SHA256binding in
JSON summaries.16artifacts verify exactly:3,335,699original bytes,368,377compressed.
Frozen suites/first-run evidence remain unchanged. Exact CI jscpd5.0.10passes9.53%
against unchanged10%threshold. Current unversioned jscpd differs;CIversion is the
relevant verification authority. Workspace checks and focused snapshot tests pass.


## Direct property refinement

A single selected property block may refine to a clearly requested direct field
using exact schema leaf and description terms. Explicit block/object requests stay
at the block;multiple candidates remain choices. No inferred validation or new
metadata is added. End-to-end public-IP fixture fails baseline and passes repair.
HTTP redirection and public IP development cases now cite exact anchors;24prompt
development14answerable reaches10selected,12top5,p95123.328ms.474URLtests and
workspacechecks pass. Full ineligible-suite regression remains35/140selected,
49.2857%top5,discovery149.465ms,complete147.005ms. No qualification claim.


## Completed source-only adjudication

Fresh20case adjudication returned SUCCESS:ten ambiguous answerable labels and
six document-role labels rejected. One single-public-port case accepted,unlike
the first collision audit. Two parent-block labels accepted using benchmark
patterns rather than exact-leaf evidence;their precision remains unresolved.
All three source reviews are retained. Frozen suite remains unchanged/ineligible;
no reviewed replacement or runtime qualification follows this audit.


## Verified parent choice expansion

A single selected property block with one verified direct-child conflict/choice
group now returns its scoped alternatives instead of a false selected leaf.
Exact branch terminology chooses that branch;broader word matching is not claimed
for unresolved configuration choices. Facets/node scope apply;multiple groups
are not expanded indiscriminately. Secret-storage red/green fixture reproduces
parent false selection and checks both alternatives,exact branch and filtering.
475URLtests+workspacechecks pass. Development storage ambiguity returns both
clear and Blindfold destinations;answerable10/14,12top5remain unchanged.
Full post-analysis regression35/140selected,49.2857%top5,scored24.1935%,
discovery154.266ms,complete146.985ms. Accuracy/latency qualification remain failed.
HTTPS mode relationships absent in metadata remain an explicit coverage gap;no
validation constraints were inferred from provider names or descriptions.


## Declaration usage routing and lexical fusion diagnostic

Resource declarations/definitions and ephemeral usage target complete minimal
configuration sections;data-source lookup usage targets root configuration. Field
and nested-rule requests preserve schema routing. Red fixtures reproduce missing
declaration route;476URLtests+workspacechecks pass. Full post-analysis regression
40/140selected,50.7143%top5,discovery145.777ms,complete140.315ms. Still far below
accuracy gate;no held-out qualification.

Production/property ranking lists are complementary:31shared top5,38production
only,28property only,43neither. Union97/140is below95percent. Precomputed reciprocal
rank fusion reaches42first,88top5;no complete response latency measured. Fusion
remains unshipped. Producer generic aliases apply to description words,spreading
certificate/backend/authentication phrases broadly. Published automatic-cert
description and missing top-level choice relationships require producer review.


## Verified sibling type navigation and producer preview

Provider-choice relationships between sibling schema types now preserve alternatives
for vague queries and select explicitly named type identifiers. Existing direct
child conflicts remain supported;caller facets/node scope remains applied. Red
fixture reproduces false manual-mode selection;477URLtests+workspacechecks pass.
Published-source regression remains40/140selected,50.7143%top5,discovery168.813ms,
complete156.921ms. Accuracy/latency qualification remain failed.

Provider2366preview index contains all9provider-choice links and reviewed automatic
certificate summary. Development10/14selected,12top5,p95224.812ms with concurrent
tests/CI;not matched qualification. Preview index SHA
bdf34d8c66197097177d05e9fe40e0b4b73f86aee861f62651237c521df8da34,
897630208bytes,gzip77935872bytes. Unpublished source and baseline provenance
explicitly disclosed;reviewed bundled pin unchanged.


## Reviewed choice terminology

Verified choice groups accept branch-exclusive reviewed aliases as deciding context.
Shared/generic TLS aliases remain undecided;explicit type identifiers retain
precedence and multiple exact names preserve comparison choices. End-to-end fixture
checks ordinary automatic-certificate wording and shared TLS wording. Published
corpus regression remains40/140selected,50.7143%top5,discovery155.102ms,complete
146.691ms;pre-enrichment source lacks new aliases. This is not qualification.
Provider153108c50c lint/security pass,but requiredCI37009759185remains pending
without jobs and no deployment approvals;no retry or restart inferred from delay.


## Whole-segment context experiment rejected

Whole-segment bonuses improved enriched-preview development from10/14to12/14
selected,but full preview selected41/140and published top5lost valid block
destinations. Bonuses and Kubernetes rescue mapping were discarded before commit.
Full preview is explicitly unpublished with baseline provenance;no pin update or
qualification claim. ProviderCI37009759185has begun jobs after pending wait;
constitution,mock,shell,and example checks pass,build/docs checks remain active.


## Direct property BM25 rejection

Separate leaf/path/description/ancestor column weights evaluated on14development
answerables. Best10first,12top5;fixed8/5/2/1weights then evaluated full regression.
88property cases:17first,62top5;52task cases outside property-index scope. Ranking
p9540.531ms excludes full responses and startup. Low exact accuracy prevents
promotion;no production or reviewed artifact change. Raw task-local digests retained.
ProviderCIaggregate job names match protection;build,vet,lint pass,race/docs live.


## Explicit unpublished preview binding

Changed regression indices require a digest-bound preview receipt and cannot run
qualification. Reports identify unpublished source commit separately from baseline
release-pin fields. Red/green scorer tests and end-to-end missing-receipt rejection
pass;workspacechecks pass. Bound enriched-preview regression41/140selected,
52.1429%top5,discovery154.920ms,complete148.480ms remains failed. No immutable
provider publication or consumer pin update follows preview evidence.


## Full semantic hybrid regression rejection

Fixed published v12.2.0 property embeddings and lexical ancestor candidates
evaluated all200previously analyzed prompts with5repetitions.19/140first,65/140
top5;embedding216.478msp95,ranking12.767ms,semantic/fusion221.380ms,estimated
route630.781ms. Complete response rendering excluded;no latency qualification.
Initial run failed with404because task server used empty default model directory;
exact retry used retained model cache and succeeded. Original raw count defect
(14answerable/24development) preserved by digest;corrected report records140/200.
Evaluator now derives counts from supplied suite. Task server stopped. Hybrid
remains unshipped and does not meet accuracy or latency gates.


## Scoped lookup grammar

Declaration/definition verbs infer resource role;querying/reading/inspecting
usage can target data-source root configuration. A leading lookup scope followed
by comma+where/which/what retains exact property retrieval rather than rewriting
to usage. Red fixtures reproduce declarations and scoped lookups.479URLtests
and workspacechecks pass. Final regression42/140selected,51.4286%top5,
discovery169.120ms,complete158.809ms remains failed. Provider source all CI
passes except exact-head linked-issue workflow still queued. No gate bypass.


## Scoped exact-identifier support

Exact identifiers must appear inside the caller-selected provider/role/facet/node
scope. A field documented only for another provider no longer broadens into
unrelated guidance. Red fixture reproduces cross-provider leakage;480URLtests,
workspacechecks and scoped integration pass. Published regression unchanged
42/140selected,51.4286%top5,discovery192.545ms,complete176.715ms;qualification
remains failed. CIregex spelling fragments and report terminology repaired.
Provider all implementation checks pass;exact-head issue check remains queued.


## Property title navigation deduplication

Property page title passages preceding canonical section anchors no longer enter
search;authoritative Markdown and exact reads remain complete. Red/green fixture
proves navigation text survives exact reads.481URLtests+workspacechecks pass.
Two reviewed v12.2.0 index builds match SQLite/gzip digests;SQLite799932416bytes,
gzip68812457bytes. Source pin preserved;derived index pin updated atomically.
Published regression43/140selected,51.4286%top5,discovery149.741ms,complete
142.963ms. Unpublished enriched preview44/140selected,52.1429%top5;still no
accuracy qualification. Tracked asset loader restored to null placeholder.


## Provider-scoped passage query

Indexed provider identity is removed from passage terms after filter inference;
provider-only search retains its existing query. Root/field exact routes and scoped
unsupported identifiers remain intact.482URLtests+workspacechecks pass. Full
regression43/140selected,52.8571%top5,discovery178.939ms,complete163.831ms
remains failed. This improves candidate recall without a qualification claim.
Provider post-merge aggregate passed;exact-source regeneration now active.


## Prose-only property search content

Property search excludes fenced validator/constraint code while complete sections
and original Markdown remain stored for exact/context reads. Example/task pages
retain code search. Red/green fixture confirms validator noise is absent from FTS
and present in exact reads.483URLtests+workspacechecks pass. Two reviewed v12.2.0
builds match SQLitec77d9f2c3cb49ad9bf06f06cd268de5f4ad5f9fc66ee4b8ccfe469a2515a5a6d
745205760bytes,gzipd40c016952592b967421134942e2f8c477875b02637c8e0b6b2e91924ccff051
65234569bytes. Published regression43/140selected,52.8571%top5,discovery129.868ms,
complete119.610ms. Enriched preview44/140selected54.2857%top5. No accuracy
qualification. Derived pin updated with source;tracked loader remains placeholder.


## Scoped exact scalar destinations

Explicit scalar identifiers query verified destination anchors within caller scope
before generic broadening. Branch context ranks all bounded matching destinations
prior to output selection;unqualified branches remain choices. Tasks/setup routes
stay distinct. Red fixture reproduces precise named-branch query falsely marked
broadened;484URLtests+workspacechecks pass. Published regression unchanged
43/140selected,52.8571%top5,discovery122.274ms,complete113.286ms;no qualification.
Provider exact-source documentation regeneration remains active.


## Literal schema suffix matching

Exact scalar and sibling suffix lookups treat underscores literally rather than
SQL LIKE wildcards. A red fixture reproduced a confident sharedxflag selection
for shared_flag with deeper matching context. Literal suffix comparisons repair
that false destination;485URLtests+workspacechecks pass. Published regression
43/140selected52.8571%top5unchanged,discovery112.092ms,complete107.889ms.
No accuracy qualification. Provider documentation regeneration remains active.


## All-branch-context rule rejected

Requiring every differing schema segment reduced regression selection43/140to
41/140and hid valid Equinix IPv6 and inside-static-route leaves. Existing query
qualifiers already excluded the alternatives. The diagonal fixture did not prove
independent missing choices. Rule and fixture removed;production restored.
Regression evidence retained without qualification or promotion. Provider2370
CIbuild/vet/lint/security pass,race and Super-Linter remain live.


## Current cross-platform regression parity

Fresh bootstrapped Mac worktree and Ubuntu source a9149f5a5use the same reviewed
gzip. All200case outcomes,destinations,ranks,responsebytes match. Complete
discovery/context hashes match,including481scores and481contextreads. Five-repeat
discoveryp95Mac94.062ms,Ubuntu104.610ms;complete91.413/101.019ms. Accuracy
43/140and52.8571%top5still fails;ineligible suite regression only. Earlier dirty
Mac worktree preserved. Final released installed acceptance remains unfinished.


## Literal branch prefix refinement

A focused regression reproduced a false port destination in branchxa when the
selected branch was branch_a. Direct-field prefix comparisons now treat schema
underscores literally. The test fails before the repair; 486 URL tests and
workspace checks pass after it. Published-corpus regression remains 43/140 correct
selections and 52.86% top-five recall. Ubuntu discovery p95 is 99.893 ms; complete
response p95 is 96.421 ms across five repetitions. This is ineligible-suite
regression evidence and does not qualify the release.

Failure triage groups the existing regression into 88 property requests (9 correct
selections, 34 expected destinations in top five) and 52 task requests (34 correct,
40 in top five). These counts guide redesign and are not independent acceptance.
Broader source-only development authoring is underway with the existing reviewer;
its material will remain separate from any new held-out qualification suite.


## Provider-scoped field and context ranking experiment

A separate development ranker weights direct field wording, descriptions and
ancestor schema context using provider-scope term frequencies. Indexed 500-case
candidate selection reaches 43/58 first and 54/58 top-five property destinations
on revised development prompts, with ranking p95 24.198 ms. The separate original
development set reaches only 8/14 first and 12/14 top five. This cross-set gap
prevents production promotion. Complete response rendering, startup impact and
confidence selection remain unverified. Three tests cover direct-field intent,
contradictory branches and deterministic ties; workspace checks pass.

An evaluator count defect caused absent IDs to group ambiguous cases as property
cases. The corrected evaluator assigns synthetic development IDs; both raw
results and the original defect digest are retained. No held-out qualification
was run or claimed. The experiment remains outside production imports.


## Canonical property terms and combined development route

Removed the experimental encrypted-to-Blindfold and unencrypted-to-clear
translations: transport encryption does not establish secret storage choice.
Red fixtures verify consistent regex-value, IPv4/IPv6, and start/end terms.
Canonicalization raises revised development first destinations to47/58 and
top-five to56/58. The separate original set remains8/14 until the existing
direct-field refinement and lifecycle timeout route are applied, then reaches
11/14first and13/14top-five. Five ranker tests and workspace checks pass.

Broad alias-token weighting and full-phrase bonuses both regress the revised
set, so they were removed. Complete failed experiment results remain retained.
Diagnostic first-destination union ceilings are52/58revised and13/14original;
these use labels and are not executable selection policy. Timing covers only
candidate queries/ranking, excluding post-ranking refinement, lifecycle routing,
responses and confidence. Preparation now reports index construction as well as
term preparation. No production import, confidence or held-out qualification.


## Property selection and complete-scope collision experiment

Seven selection tests cover omitted branches, role collisions, low coverage,
close fields, contradictory IP/route evidence and alternatives outside top five.
The initial policy selected one false HTTP-redirect mode on original development
prompts. Indexed same-leaf checks eliminate that false leaf. Caller-inferred
provider role is honored; matching names with different descriptions are not
automatically treated as equivalent. Final development selection remains only
10/58correct leaves on the revised set and5/14on the original,with no observed
false leaf in these runs. Unnecessary clarification prevents promotion.

The rendering evaluator reads complete local sections and reports oversized
notices, but its latency adds precomputed ranking samples and excludes indexed
collision lookup. It is explicitly estimated rendering-route timing, not measured
integrated complete-response latency. Original mislabeled timing report digests
are preserved. Twelve ranker/selection tests and workspace checks pass. No
production imports or held-out qualification; source-label defects remain.

 
## Explicit branch exclusion and documented-vocabulary coverage

A red selection fixture reproduced unnecessary clarification between dual-stack
and ordinary IP address branches when the prompt explicitly requested dual
stack. An excluded identical-field branch no longer triggers score-gap
clarification. Unknown vocabulary no longer receives provider-scope rarity
weight; explicit unsupported identifiers remain a separate fail-closed check.
Fifteen ranking and selection tests pass, together with workspace checks.

The complete development route times candidate queries, ranking, direct-field
refinement, lifecycle routing, indexed collisions, selection and bounded
discovery/context rendering inside each repetition. Five repetitions produce
identical response hashes. With workspace checks stopped, measured experimental
p95 is25.169msrevised and17.124msoriginal. Preparation is744.512/729.992ms.
Selected leaves improve to24/58and9/14with zero observed false leaf on these
development sets; rankings reach48/58and12/14first. This remains insufficient
for promotion. In-memory FTS and preloaded scope statistics remain experimental;
final indexed artifact, installed routes and valid held-out qualification are
unverified. No production module imports this experiment.


## Prepared property index and explicit field/block intent

A tested field-selection rule excludes the enclosing block when the caller
names a direct scalar field, and distinguishes a complete multiword field from
nearby siblings. Explicit block phrases outrank incidental description mentions.
Final complete experimental route reaches27/58correct selections and49/58first
destinations on revised development,with zero observed false leaf;original
remains9/14selected. Twenty ranking/selection/index tests and workspace checks
pass. Complete-route timing here ran alongside source checks and is not final
cross-platform performance qualification.

Dedicated property_scopes,property_scope_terms,property_terms and property_search
tables store prepared vocabulary and provider-scope statistics. Targeted SQL
fetches bounded candidates and their terms rather than loading whole-corpus
metadata at runtime. Two independent56,627,200-byteprototype indexes match
SHA2561796d6d165e9bd57e5c1f18b683a0f906248a9e651be1542daec3cb8ac5f93c2.
Ranking reaches49/58first and56/58topfive on revised development at30.809ms
p95;original8/14first and12/14topfive before refinement/lifecycle routing.
Ambiguous-query candidate differences are retained and prevent broad parity
claims. Prototype remains outside production;complete targeted route,filters,
continuations,installed artifact and valid held-out qualification remain required.

 
## Targeted complete route and prepared-index provenance

The complete property experiment now queries prepared terms and only requested
provider weights with indexed SQL. It uses targeted source metadata, timeout
destinations, collision queries and exact section reads rather than preparing
whole-corpus metadata at runtime. Complete-route p95 is28.201msrevised and
29.537msoriginal over five repetitions; outcomes remain27/58and9/14correct
selections with zero observed false leaf. These development sets remain
defective and cannot qualify release.

AND category/task facet and descendant-node constraints pass a red/green index
test. Prepared index version1binds the exact source commit and source SQLite
digest; mismatches fail closed. The source-bound side index is56,631,296bytes,
SHA2567aae0c725d33ce1d012e571c74ec68f464b913a742366c188a7d8d39e1a42785.
This is a prototype artifact outside the reviewed bundled pin. Bundled generation
integration, cross-platform complete responses and installed qualification remain
unfinished. Twenty-two ranking/selection/index tests and workspace checks pass.


## Indexed task route and requested field vocabulary

The development route resolves canonical setup, authentication and lifecycle
sections with indexed provider, role, AND facets and descendant constraints.
Query-inferred identity is distinct from binding caller scope. Literal unsupported
identifiers fail closed. Certificate authentication without a representation
returns exact P12/PEM choices. Provider/task inference is inside each timed
repetition; context uses complete pinned sections and oversized full-read notices.

A red fixture exposed provider-name words erasing a requested token field.
Requested field words now survive identity removal. Another pair of red fixtures
checks explicit single-stack and exclusive terms in shared multiword branch names;
omitted stack/branch evidence continues to return choices. Thirty-two focused
experiment tests pass. No production module imports these prototypes.

Final development results are 37/60 expected leaf selections (35/58 properties),
51/58 first-ranked property destinations and 56/58 top-five, with zero observed
false leaves. Original development remains 9/14 selected and 13/14 top-five.
Complete experimental warm p95 is 28.403 ms revised and 33.383 ms original over
five repetitions with identical discovery/context hashes. Measurements exclude
cold materialization, installed/model/network time and final artifact integration.
Raw synthetic reports are gzip compressed deterministically and digest-bound in
indexed-task-property-receipt.json. Development labels remain defective and
these measurements do not satisfy the retained 95% qualification gate.

A fresh existing Antigravity reviewer is auditing all development labels in a
source-only v12.3.1 workspace. No replacement held-out suite is frozen or run.
Consumer PR remains draft with auto-merge disabled until valid qualification
and human acceptance.

Control audit of the same report finds three unsupported natural-language controls
selecting unrelated leaves (078-080), and one ambiguous-labeled case selecting an
action overview (071; label uniqueness remains under source review). Zero observed
false leaves above is restricted to answerable cases, not a safety qualification.
Report counters now expose control and ambiguous leaf selections explicitly.
These failures independently prevent production promotion.

A red/green requested-operation fixture now requires local field/description
evidence after an explicit operation verb. Provider vocabulary alone cannot
justify an unrelated requested operation. Latest revised development selects
35/60 expected leaves, with zero answerable false leaves and zero leaf selections
on eight controls; one ambiguous-labeled action overview remains under review.
Original development remains 9/14 answerable selections, with three ambiguous
leaf selections and zero leaf selections on two controls. Neither suite is valid
held-out qualification. Revised/original p95 is 28.881/31.569 ms. Thirty-three
focused tests pass. Digest-bound raw reports: indexed-task-intent-receipt.json.
The policy sacrifices two answerable selections with paraphrased field wording;
that limitation remains unresolved and prevents promotion.

The source-bound prototype produces identical rankings, exact anchors, scores,
selection decisions and discovery/context hashes on all 80 revised development
cases on Mac arm64 and Ubuntu x64, each with five complete-response repetitions.
Mac/Ubuntu experimental warm p95 is 32.395/28.881 ms. Both hosts pass 33 focused
experiment tests. The copied Mac harness uses existing bootstrapped dependencies;
source SQLite and property side-index digests match the pinned source exactly.
This is development parity, not released/offline/installed acceptance. Synthetic
Mac raw output and cross-host receipt are retained in indexed-task-intent-mac.json.gz
and indexed-task-intent-parity-receipt.json.

A red/green fixture distinguishes requested field wording from trailing for-branch
context without accepting unsupported operations. Latest revised development is
36/60 selected (34/58 properties), zero answerable wrong leaves, zero leaf
selections on eight controls and one ambiguous-labeled action overview. Original
remains 9/14 selected. All 80 revised case rankings/scores/anchors/decisions and
response hashes match Mac/Ubuntu over five repetitions. Latest p95 is
32.434 ms Mac and 29.230 ms Ubuntu; original Ubuntu p95 is 31.550 ms.
Latest raw reports and provenance: indexed-task-local-intent-receipt.json and
indexed-task-local-intent-parity.json. This supersedes earlier development metrics,
remains outside production, and does not qualify the retained 95% gate.

Network-disabled prototype runs (Mac Seatbelt deny network, Ubuntu unshare net)
complete all 80 revised development cases with identical online/offline rankings,
scores, anchors, decisions and response hashes. Offline p95 is 33.978 ms Mac and
28.604 ms Ubuntu. Digest-bound synthetic output is retained with
indexed-task-local-intent-offline.json. This does not qualify an installed artifact.


## Fresh v12.3.1 development-label source audit

The authorized existing Antigravity reviewer audited all 80 development cases
against exact pinned Markdown with implementation and results withheld. Review
verdict is label-defects: twelve formerly answerable prompts omit same-role
branch choices or target the wrong prefix/exact-path anchor. All reported
alternative destinations were independently checked for exact source anchors.
Review and digest-bound provenance are under revised-development/v1231-source-audit*.

Original data is preserved. Derived source-audited-development.json keeps prompts
and reclassifies those twelve cases as ambiguity, correcting the prefix anchor.
It contains 48 answerable, 24 ambiguous and eight controls. The unchanged
prototype selects 36/48 expected answerable leaves, with zero answerable wrong
leaves and zero control leaf selections. One ambiguous action still selects a
leaf: singular versus bulk termination is missing. This is development only,
not 95% qualification; frozen replacement and installed model acceptance remain
unstarted. Exact output is source-audited-indexed-development.json.gz.

A red/green action cardinality fixture prevents inferred singular/plural provider
identity from resolving an omitted single-versus-bulk action choice. Explicit
provider identifiers and explicit multiple/bulk terms still route directly.
Audited development remains 36/48 selected, with zero observed answerable wrong
leaves, zero ambiguous leaf selections and zero control leaf selections. All
46 property expected destinations remain top-five. Thirty-five focused tests
pass. p95 is 28.928 ms Ubuntu. Raw synthetic results and source hashes are
source-audited-cardinality-development*. Production integration and the retained
95% qualification gate remain unfinished.


## Prepared terminology v2 and conservative selection evidence

Reviewed-schema terminology canonicalizes gateway/gw, request bodies/body,
FlashArray/flash_array, FlashBlade/flash_blade and session identifiers/ids.
Prepared property index version 2 rejects stale v1 vocabulary. Two builds are
byte-identical: 56,610,816 bytes, SHA256
b2bab5d3164837a39cd345fc0d40041bd464029082c68612c24b1400f61666f1.

Requested-operation evidence includes exact schema context, while provider
identity words cannot justify an unrelated requested operation. Strictly stronger
local requested-field evidence separates incidental competing fields. Explicit
custom static routes exclude simple-static-route choices. Full branch terminology
is required for repeated-leaf collisions; an experiment using exclusive tokens
selected an audited ambiguous crawler leaf and is rejected. Its raw output is
preserved alongside final output in property-terms-v2-receipt.json.

Final audited development: 39/48 answerable selected, zero answerable wrong leaves,
zero leaf selections on 24 ambiguous/eight control cases. Property top-five is
46/46, first 44/46. Original remains 9/14 selected and 13/14 top-five. Complete
experimental p95 is 28.326 ms audited; original 44.496 ms ran with source checks
and is not final performance qualification. Forty-two focused tests and workspace
checks pass. Production imports remain unchanged, frozen qualification remains
unstarted, and the 95% gate is unmet.

Where-to-specify/set questions without an explicit block request now
receive the existing scalar-field intent treatment. A red/green fixture checks
scalar IPv4 destination versus enclosing dual-stack block and preserves explicit
block intent. Audited development improves to 40/48 selected, zero answerable
wrong leaves and zero ambiguous/control leaf selections. Property first/top-five
is 45/46 and 46/46. Original remains 9/14 selected. Forty-three focused tests
pass. Exact development raw reports and source hashes are retained in
where-field-development-receipt.json. No production promotion or qualification.


## Bundled prepared-property tables integration

The production index builder now generates prepared property tables with exact
canonical destinations; ranking/index modules are moved to src and bench imports
re-export them. Search routing is still unchanged and qualification is incomplete.
A red/green snapshot test requires table version 2, one row per canonical
destination and deterministic generated indexes. Runtime SQLite integrity is ok;
all 39,565 destinations are prepared. The reviewed v12.3.1 index is rebuilt from
verified immutable snapshot assets: 781,434,880 bytes, gzip 70,980,995 bytes.
Exact digests and source hashes: bundled-property-index-integration.json.
493 internal-URL tests and focused snapshot/index/delivery tests pass. Bundled
prebuilt verification passes. The outer immutable index digest binds the integrated
tables; the separate source-index digest is used only for side-index experiments.


## Actual bundled adaptive resolver integration

Production discovery now uses prepared indexed property ranking and complete
scope collision selection for natural-language field requests. Indexed task
routing returns exact authentication choices and protects omitted action
cardinality. Explicit identifiers, overview/role requests and ordinary block
requests retain existing paths; credential block questions use conservative
property selection. Display limits do not reduce selection evidence. Exact reads
and caller AND facets remain covered by regression tests. Shared selection/task
modules live in src, with development re-exports.

Actual production resolver measurements include full discovery and selected
context reads, byte budgets and identical response hashes over five repetitions.
Audited development: 39/48 correct leaves, zero answerable wrong leaves, zero
ambiguous/control leaf selections and 48/48 expected destinations top-five.
Original development: 9/14 correct leaves, zero answerable wrong leaves, three
ambiguous leaf selections (labels still unaudited) and 13/14 top-five.
494 internal URL tests and workspace checks pass. Timings ran alongside checks
and are development measurements only, not cross-platform qualification. Raw
reports and source digests are in production-adaptive-receipt.json. The retained
95% gate, fresh independent frozen 200 cases, 40 installed model cases and release
acceptance remain incomplete; PR stays draft without auto-merge.


## Qualified branch and scalar evidence in production selection

Parallel equally deep schema segments can share boilerplate while a unique
qualified term distinguishes them. Path vocabulary permutations with identical
leaf descriptions now retain missing nesting order; the rejected broader rule
selected an ambiguous cookie combinator and is preserved as rejected evidence.
Named scalar descendants exclude enclosing blocks. Reference-name requests
exclude trailing usage context and compare field evidence with schema context.

Actual production audited development reaches 44/48 leaves (91.67%), with zero
wrong answerable leaves and zero ambiguous/control leaf selections; 48/48 expected
destinations remain top-five. Original remains 9/14 selected, zero wrong leaves,
three ambiguous selections on labels not yet audited and 13/14 top-five.
494 internal URL tests pass. Source and raw-output hashes are retained in
production-branch-evidence-receipt.json. Development is not qualification;
fresh held-out/installed gates and four audited answerable misses remain open.

Query-only terminology normalizes header strip/remove, before-forwarding/upstream,
source network address translation/SNAT, IP address prefixes/prefixes and permits/permit.
Indexed corpus vocabulary and index digest stay unchanged. Schema block intent
uses conservative indexed selection. Actual audited development reaches 47/48
(97.92%) with zero wrong answerable leaves and zero ambiguous/control leaf
selections; all expected destinations remain top-five. The remaining case omits
IPv4 versus IPv6 and stays choices. Original remains 9/14, zero wrong leaves,
three ambiguous selections on unaudited labels. 494 internal-URL tests pass.
These are development measurements, never held-out qualification. Fresh
source-only Antigravity authoring for an entirely new 200-case candidate is
started; no candidate is inspected, frozen or run yet.
