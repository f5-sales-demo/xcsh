# Terraform v7 source failure analysis

**EXPOSED REGRESSION ONLY — original result unchanged; no qualification claim or tuning.**

First untouched run: **32/140 correct (22.86%), 72/140 top five (51.43%)**, Linux warm p95 **102.215 ms**, Mac warm p95 **82.89020800000071 ms**. All 200 original outcomes/destinations/complete-response hashes match Mac. The 95% accuracy gate and every-answerable top-five requirement remain unchanged.

All **108 original answerable failures** retained: **46 wrong selected leaves**, **22 missing-target/unselected**, and **40 target-present/unselected**. Source-label concerns never revise the original result.

## Method and limits

- First scored artifact lacks internal candidate pools and selection reasons. Counts classify observable failures exactly; causal paths are current-source-supported static inferences, not historical replay proofs.
- Pinned source_commit identifies provider source; inspected current retrieval implementation is separately hashed and may differ from first-run implementation.
- All original 108 failures remain failures, including two separately documented source-label defects. No revised accuracy or qualification claim.
- Development prompts are report-only synthetic proposals, not executable benchmark cases, source-approved labels or independently reviewed tests.
- No dependencies/bootstrap, GitHub, network, agents, Terraform, resolver evaluation or model calls were executed. User read-only restrictions govern this source review.

JSON records full original outcomes, frozen text, expected/returned paths, evidence quotations and exact current source locations with hashes. Counts use one primary diagnosis per original failure; secondary dimensions capture overlapping defects.

## Root cause counts

| Primary diagnosis | Count | Cases |
|---|---:|---|
| Field request preempted by task/root routing | 4 | A010, A014, A033, A118 |
| Owner or provider-role alias resolution fails | 7 | A028, A037, A052, A054, A058, A128, A133 |
| Specific value lookup collapses to ancestor block or choice | 25 | A009, A017, A021, A022, A023, A024, A025, A039, A040, A042, A043, A044, A070, A084, A089, A097, A101, A104, A105, A107, A116, A121, A124, A125, A126 |
| Navigation aliases or terminal words override qualified field meaning | 20 | A001, A002, A004, A007, A015, A020, A032, A036, A071, A078, A079, A082, A088, A095, A096, A098, A102, A110, A112, A117 |
| Predicate, paraphrase or relational meaning lost in lexical intent/ranking | 12 | A011, A034, A045, A047, A049, A056, A068, A090, A091, A100, A106, A114 |
| Target first but no leaf selected | 22 | A012, A013, A018, A026, A035, A038, A041, A051, A053, A055, A057, A073, A074, A076, A081, A099, A103, A111, A115, A122, A123, A127 |
| Target in top five behind competitor; no leaf selected | 16 | A008, A016, A019, A046, A048, A050, A060, A065, A072, A093, A094, A109, A113, A120, A131, A132 |
| Concrete label exclusion lacks user branch discriminator | 2 | A130, A134 |

### Field request preempted by task/root routing

Task routing precedes indexed property retrieval. The resource ... documented pattern returns minimal-configuration unless field/attribute/property/parameter/schema-path vocabulary is present, so ordinary value lookups can become an overview.

Locations: coding-agent/src/internal-urls/terraform-documentation.ts:873; coding-agent/src/internal-urls/terraform-documentation.ts:1593.

### Owner or provider-role alias resolution fails

Literal and normalized names plus longest-match and owner templates do not cover all product aliases or ownership constructions. Referenced products can capture identity; natural allowlist aliases can lose their data-source owner.

Locations: coding-agent/src/internal-urls/terraform-documentation.ts:1012; coding-agent/src/internal-urls/terraform-documentation.ts:1081.

### Specific value lookup collapses to ancestor block or choice

Find/locate/setting/selector paraphrases incompletely enter indexed property retrieval. Block and collection interpretation then permits ancestor navigation; direct refinement considers only immediate children and refuses collection queries.

Locations: coding-agent/src/internal-urls/terraform-property-ranking.ts:221; coding-agent/src/internal-urls/terraform-property-ranking.ts:363; coding-agent/src/internal-urls/terraform-documentation.ts:727.

### Navigation aliases or terminal words override qualified field meaning

A request missing the property gate falls through to navigation aliases. Alias specificity replaces rows; generic root name/address/namespace/location can defeat relational scope. Positive literal schema-path handling is stronger than ordinary or negated branch prose.

Locations: coding-agent/src/internal-urls/terraform-documentation.ts:1998; coding-agent/src/internal-urls/terraform-documentation.ts:2062; coding-agent/src/internal-urls/terraform-property-ranking.ts:166.

### Predicate, paraphrase or relational meaning lost in lexical intent/ranking

OR-term BM25 caps candidates at 500 plus exact short leaf rescue. Leaf/context/description overlap does not preserve the requested operation, relation and polarity. Missing returned target does not establish whether the target was absent from internal candidates.

Locations: coding-agent/src/internal-urls/terraform-property-index.ts:184; coding-agent/src/internal-urls/terraform-property-index.ts:240; coding-agent/src/internal-urls/terraform-property-ranking.ts:409.

### Target first but no leaf selected

Original rank=1 and selected=false. Coverage, requested-operation evidence, full-scope collision checks and score separation can force choices. Exact historical guard is not recorded; a ranking fix alone cannot repair this outcome.

Locations: coding-agent/src/internal-urls/terraform-property-selection.ts:258; coding-agent/src/internal-urls/terraform-property-selection.ts:378; coding-agent/src/internal-urls/terraform-property-selection.ts:481.

### Target in top five behind competitor; no leaf selected

Original rank=2–5 and selected=false. Ranking and intent discrimination need repair before confidence; merely relaxing selection risks picking the competitor.

Locations: coding-agent/src/internal-urls/terraform-property-index.ts:184; coding-agent/src/internal-urls/terraform-property-index.ts:240; coding-agent/src/internal-urls/terraform-property-ranking.ts:409.

### Concrete label exclusion lacks user branch discriminator

Identical optional boolean meaning exists in sibling defaults and virtual-storage-pool defaults. Frozen request does not specify virtual storage pools or storage-class matching. Original expected path is not a prompt discriminator; retain the original failure.

Locations: /tmp/terraform-v1240-qualification-v7-corrected-frozen/case-source-evidence.json:/129/peer_adjudications; /tmp/terraform-v1240-qualification-v7-corrected-frozen/case-source-evidence.json:/133/peer_adjudications.

## Concrete source-label concerns, kept separate

**A130**: Sibling branch excluded without a request discriminator. Both satisfy stated custom-storage/NetApp/ONTAP SAN qualifiers and identical field meaning. Prompt never selects virtual storage pools or storage-class label matching.

Expected source: Enable Encryption. Enable NetApp volume encryption.

Excluded sibling source: Type: `"bool"`. Optional.

Enable Encryption. Enable NetApp volume encryption.

The attached expected branch description says virtual storage pool definitions referenced by storage-class label matching; the sibling describes default provisioning. The prompt supplies neither virtual-pool nor storage-class discrimination. Require virtual-pool discriminator or permit/clarify both source-supported siblings; no score substitution or relabeling performed.

**A134**: Sibling branch excluded without a request discriminator. Both satisfy stated custom-storage/NetApp/ONTAP SAN qualifiers and identical field meaning. Prompt never selects virtual storage pools or storage-class label matching.

Expected source: Split a clone from its parent upon creation.

Excluded sibling source: Type: `"bool"`. Optional.

Split a clone from its parent upon creation.

The attached expected branch description says virtual storage pool definitions referenced by storage-class label matching; the sibling describes default provisioning. The prompt supplies neither virtual-pool nor storage-class discrimination. Require virtual-pool discriminator or permit/clarify both source-supported siblings; no score substitution or relabeling performed.

## Existing experiments and rejection evidence

| Experiment | Existing recorded result | Limits |
|---|---|---|
| Gemma documents | 0/6 first, 1/6 top five; ~240 ms | Document ranking; no exact section selection |
| Gemma passages | 2/6 first, 3/6 top five; ~229 ms | Tiny known development set; no confidence or prerequisites |
| Gemma hybrid regression | 19/140 first, 65/140 top five; ~631 ms estimated route | Older v12.2 source; exposed regression; rendering excluded |
| MiniLM reproduction | 38/48 first, 45/48 top five; ~63 ms reproduced | Candidate-only; lexical precomputed; local runtime |
| v12.4 MiniLM rejected | Broad 34/43 first, 41/43 top five; revised 34/48, 46/48; ~69/~82 ms | Rejected fusion did not improve leaf ranking; still top-five misses |
| Fielded BM25 rejected | 33/48 first, 39/48 top five; ~21 ms | No refinement, task or selection timing |
| Property BM25 rejected | 17/88 property first, 62/88 top five; ~41 ms | 52 task cases outside scope; regression-only |

`hybrid_ranking.py:7` performs reciprocal rank fusion with constant 20; this supplies order, not intent or confidence. `minilm_experiment.py:142` restricts vectors using upstream lexical role/provider scope, so a wrong owner cannot be recovered. `build_minilm_vectors.py:39` flattens descriptions/role/provider/path; it does not encode relational branch logic. Plain-input MiniLM vectors were also rejected; input construction and hashes matter alongside model identity. Corrected timing receipts explicitly exclude precomputed lexical work from earlier semantic p95 claims.

Other rejection receipts: generic named-block preference reduced development selections 43→40; requiring every differing branch segment caused unnecessary clarification; hard required/computed filtering hid optional fields; unconditional scalar preference selected an unsupported request; broad property triggers regressed literal branch-prefix behavior. Do not repeat these shortcuts. Complete receipts and hashes are included in JSON.

## Architecture assessment

**Decision:** Investigate meaningful structured semantic retrieval next; necessity of dense embeddings is unproven. Existing prototypes should not be promoted.

**Evidence:** 68 targets absent from returned top five expose routing/discovery weakness; 40 present but unselected expose selection/intent weakness. Dense reranking alone cannot repair property gate bypass, task preemption, wrong owner or unsupported branch certainty.

**Design proposal:** Shared typed intent and owner/role resolution; canonical hierarchical section index; bounded lexical plus optional offline semantic candidate union; relation/polarity-aware reranking; separate evidence/ambiguity selection; complete source-section read. Compare lexical, structured and semantic ablations on independently grounded development material.

**Index size:** Original index: 800,915,456 bytes expanded / 72,608,838 compressed, cold materialization 2,835.686 ms. MiniLM vectors: 60,771,968 extra bytes before model/runtime overhead; Gemma passage vectors: 121,519,232 bytes. Measure actual memory, package and cold-load costs. Quantization/ANN are unverified design options.

**Offline:** MiniLM uses pinned local_files_only model files, but Python experiments do not demonstrate a bundled production runtime or installed offline parity. Verified model/vector provenance, deterministic missing-asset behavior and bounded fallback are needed.

**Latency:** First Linux warm p95 is 102.215 ms. Arithmetic headroom to 150 ms is 47.785 ms, not an additive p95 guarantee. v12.4 MiniLM p95 68.974/82.005 ms excludes lexical generation, selection and rendering. Corrected Gemma route estimates ~600–638 ms exceed gate. Measure complete routes; never sum unlike p95s as qualification.

**False claims:** Nearest neighbours always exist. Require explicit support/abstention, binding role/scope, polarity and ambiguity checks; preserve zero unsupported-field and false-live-apply claims. Improved top-five retrieval is not an answer-quality or live-apply claim.

**Next step limit:** Report proposals only. No tuning, implementation, benchmark authoring or model UAT authorized/performed.

## General rules

- Use one typed intent representation across routing, ranking and selection: owner, provider role, task versus lookup, field/block/collection, requested predicate, branch constraints, negation and missing-value requests.
- Require positive overview/configuration evidence for root/task routing. Natural locate/find/setting/value queries must reach property retrieval; failure there cannot become a selected minimal configuration page.
- Resolve owner independently from referenced concepts. Derive aliases from canonical source metadata and role relationships, not case IDs, expected paths or benchmark phrase lists.
- Use schema type and nesting to distinguish scalar field, list entry, collection wrapper and empty-object choice. Avoid universal scalar bonuses or generic named-block preference.
- Preserve hierarchical relations and negative qualifiers before scoring. A root terminal word must not override a nested branch requirement.
- Expose candidate recall separately from final selection. OR-term retrieval, capped pools, source-derived aliases and any semantic candidates must use the same binding caller scope.
- Check viable competitors against source meaning and user discriminators. Clarify truly missing branches; do not require every differing path segment when one qualifier excludes all alternatives.
- Use source support and ambiguity checks independently of score gaps. Similarity and reciprocal-rank scores are ranking values, not probabilities or proof a field exists.
- Read exact canonical sections and preserve citation, secret-value clarification and false-live-apply constraints. Semantic retrieval cannot supply invented settings or deployment success.
- Retain 95% accuracy and all-answerable top-five gates. Exposed v7 is regression-only; development ideas below must never become frozen-case answer rules.

## Proposed independent development prompts/tests

These are report-only proposals, distinct from frozen case text. They are neither executable benchmark artifacts nor independently verified labels. Future development must independently source schemas and review acceptance criteria; no case-specific answer rule is proposed.

**INTENT** — Synthetic sensor schema: calibration.offset and a setup page. “Point me to the adjustment that shifts every measured reading.”

Acceptance proposal: Select scalar without a field noun; explicit setup-example request routes to the setup page; compare reordered lookup verbs.

**OWNER_ROLE** — Synthetic artifact resource references a remote runner. “For the artifact resource, locate its retention ceiling while using the remote runner.”

Acceptance proposal: Artifact owns the lookup even if runner name is longer. Compare resource/data-source/action, absent and conflicting roles, and source-derived alias spellings.

**SHAPE** — Synthetic queue schema: retry_policy.maximum_attempts scalar, retry_policy block, delivery_targets collection. “Find the ceiling on failed delivery attempts.”

Acceptance proposal: Select scalar; “declare retry policy block” selects block; “choose the delivery targets collection” selects wrapper. Include scalar boolean enablement versus exclusive empty-object options.

**SCOPE** — Synthetic router has root address, uplink.ipv6.address and management.ipv6.address. “Locate the uplink IPv6 address; exclude management.”

Acceptance proposal: Never substitute root address. Compare positive prose, dotted scope, negative branch phrases, ordering and contradictory qualifiers.

**VALUE** — Synthetic vault has clear_secret.uri and encrypted_secret.location. “Find where the unencrypted credential URI belongs. Ask for my value afterward.”

Acceptance proposal: Missing-value wording does not switch branch or target; no invented credential.

**CONFIDENCE** — Synthetic scheduler delay postpones launch; timeout bounds active execution. “Which delay postpones launch before execution begins?”

Acceptance proposal: Unique supported target selected despite nearby scores; “execution timing” clarifies; high-score unsupported purpose abstains.

**SEMANTIC** — Synthetic volume has transient_capacity (temporary scratch bytes) and durable_capacity. “Where is space for throwaway working files specified?”

Acceptance proposal: Exact transient scalar through paraphrase; retain durable/transient distinctions; score candidate recall, leaf selection and unsupported claims separately.

**COLLISION** — Synthetic backend defaults.encrypted and virtual_pools.defaults.encrypted have identical descriptions. “Locate default volume encryption.”

Acceptance proposal: Preserve ambiguity or equivalent destinations; explicit virtual pool/storage-class discriminator resolves; candidate order alone cannot create certainty.

**LIFECYCLE** — Synthetic widget has operation timeouts and network idle timeout. “Locate the limit while refreshing widget state.”

Acceptance proposal: Read lifecycle scalar handles inflection; refresh-docs request and network inactivity stay distinct.

**OFFLINE_LATENCY** — Proposed engineering checks: synthetic hierarchy growth, corrupt/missing vector assets, absent local model, cold/warm starts on both supported platforms.

Acceptance proposal: Measure full route/rendering, materialization, RSS and compressed/expanded index/model bytes; bounded verified fallback; no runtime network dependency.

## Complete failure inventory

Full case evidence and current source locations are in JSON. Original passed=false throughout. Rank “None” means expected target absent from returned destinations.

| Case | Primary cause | Rank | Selected | Expected | First returned |
|---|---|---:|---|---|---|
| A001 | ALIAS_ROOT_FALLTHROUGH | None | False | resources/cloud_credentials/properties/aws_assume_role/index.md#schema-aws_assume_role--duration_seconds | resources/cloud_credentials/properties/gcp_cred_file/credential_file/blindfold_secret_info/index.md#section |
| A002 | ALIAS_ROOT_FALLTHROUGH | None | False | resources/cloud_credentials/properties/aws_assume_role/index.md#schema-aws_assume_role--role_arn | resources/cloud_credentials/properties/gcp_cred_file/credential_file/blindfold_secret_info/index.md#section |
| A004 | ALIAS_ROOT_FALLTHROUGH | None | False | resources/cloud_credentials/properties/aws_assume_role/index.md#schema-aws_assume_role--session_tags | resources/cloud_credentials/properties/gcp_cred_file/credential_file/blindfold_secret_info/index.md#section |
| A007 | ALIAS_ROOT_FALLTHROUGH | None | True | resources/certificate/properties/private_key/clear_secret_info/index.md#schema-private_key--clear_secret_info--url | resources/certificate/properties/private_key/blindfold_secret_info/index.md#schema-private_key--blindfold_secret_info--location |
| A008 | RANKING_AND_CONFIDENCE_TOP5 | 3 | False | resources/certificate/properties/private_key/blindfold_secret_info/index.md#schema-private_key--blindfold_secret_info--decryption_provider | resources/certificate/properties/certificate_chain/index.md#schema-certificate_chain--name |
| A009 | BLOCK_FIELD_INTENT | None | True | resources/certificate/properties/custom_hash_algorithms/index.md#schema-custom_hash_algorithms--hash_algorithms | resources/certificate/properties/custom_hash_algorithms/index.md#section |
| A010 | TASK_ROOT_PREEMPTION | None | True | resources/certificate/properties/timeouts/index.md#schema-timeouts--delete | resources/certificate/index.md#minimal-configuration |
| A011 | SEMANTIC_INTENT_RANKING | None | False | resources/certificate/properties/timeouts/index.md#schema-timeouts--read | resources/certificate/properties/certificate_chain/index.md#section |
| A012 | CONFIDENCE_WITH_TARGET_FIRST | 1 | False | resources/origin_pool/properties/advanced_options/index.md#schema-advanced_options--connection_timeout | resources/origin_pool/properties/advanced_options/index.md#schema-advanced_options--connection_timeout |
| A013 | CONFIDENCE_WITH_TARGET_FIRST | 1 | False | resources/origin_pool/properties/advanced_options/circuit_breaker/index.md#schema-advanced_options--circuit_breaker--pending_requests | resources/origin_pool/properties/advanced_options/circuit_breaker/index.md#schema-advanced_options--circuit_breaker--pending_requests |
| A014 | TASK_ROOT_PREEMPTION | None | True | resources/origin_pool/properties/advanced_options/circuit_breaker/index.md#schema-advanced_options--circuit_breaker--retries | resources/origin_pool/index.md#minimal-configuration |
| A015 | ALIAS_ROOT_FALLTHROUGH | None | True | resources/origin_pool/properties/advanced_options/http1_config/header_transformation/preserve_case_header_transformation/index.md#section | resources/origin_pool/properties/index.md#schema-name |
| A016 | RANKING_AND_CONFIDENCE_TOP5 | 2 | False | resources/origin_pool/properties/advanced_options/http1_config/header_transformation/proper_case_header_transformation/index.md#section | resources/origin_pool/properties/advanced_options/http1_config/header_transformation/preserve_case_header_transformation/index.md#section |
| A017 | BLOCK_FIELD_INTENT | None | True | resources/origin_pool/properties/advanced_options/http2_options/index.md#schema-advanced_options--http2_options--enabled | resources/origin_pool/properties/advanced_options/index.md#schema-advanced_options--connection_timeout |
| A018 | CONFIDENCE_WITH_TARGET_FIRST | 1 | False | resources/origin_pool/properties/advanced_options/index.md#schema-advanced_options--http_idle_timeout | resources/origin_pool/properties/advanced_options/index.md#schema-advanced_options--http_idle_timeout |
| A019 | RANKING_AND_CONFIDENCE_TOP5 | 2 | False | resources/origin_pool/properties/advanced_options/index.md#schema-advanced_options--max_requests_per_connection | resources/origin_pool/properties/advanced_options/no_request_limit_per_connection/index.md#section |
| A020 | ALIAS_ROOT_FALLTHROUGH | None | True | resources/app_firewall/properties/blocking_page/index.md#schema-blocking_page--blocking_page | resources/app_firewall/properties/index.md#schema-id |
| A021 | BLOCK_FIELD_INTENT | None | True | resources/app_firewall/properties/custom_anonymization/anonymization_config/cookie/index.md#schema-custom_anonymization--anonymization_config--cookie--cookie_name | resources/app_firewall/properties/custom_anonymization/index.md#section |
| A022 | BLOCK_FIELD_INTENT | None | True | resources/app_firewall/properties/custom_anonymization/anonymization_config/http_header/index.md#schema-custom_anonymization--anonymization_config--http_header--header_name | resources/app_firewall/properties/custom_anonymization/index.md#section |
| A023 | BLOCK_FIELD_INTENT | None | True | resources/app_firewall/properties/custom_anonymization/anonymization_config/query_parameter/index.md#schema-custom_anonymization--anonymization_config--query_parameter--query_param_name | resources/app_firewall/properties/custom_anonymization/anonymization_config/index.md#section |
| A024 | BLOCK_FIELD_INTENT | None | True | resources/app_firewall/properties/bot_protection_setting/index.md#schema-bot_protection_setting--good_bot_action | resources/app_firewall/properties/detection_settings/index.md#section |
| A025 | BLOCK_FIELD_INTENT | None | True | resources/app_firewall/properties/detection_settings/bot_protection_setting/index.md#schema-detection_settings--bot_protection_setting--malicious_bot_action | resources/app_firewall/properties/detection_settings/index.md#section |
| A026 | CONFIDENCE_WITH_TARGET_FIRST | 1 | False | resources/app_firewall/properties/allowed_response_codes/index.md#schema-allowed_response_codes--response_code | resources/app_firewall/properties/allowed_response_codes/index.md#schema-allowed_response_codes--response_code |
| A028 | OWNER_IDENTITY_ALIAS | None | False | resources/workload_flavor/properties/index.md#schema-ephemeral_storage | resources/workload/properties/job/containers/index.md#schema-job--containers--flavor |
| A032 | ALIAS_ROOT_FALLTHROUGH | None | True | resources/container_registry/properties/index.md#schema-user_name | resources/container_registry/properties/index.md#schema-registry |
| A033 | TASK_ROOT_PREEMPTION | None | True | resources/container_registry/properties/index.md#schema-email | resources/container_registry/index.md#minimal-configuration |
| A034 | SEMANTIC_INTENT_RANKING | None | False | resources/container_registry/properties/password/clear_secret_info/index.md#schema-password--clear_secret_info--url | resources/container_registry/properties/password/blindfold_secret_info/index.md#section |
| A035 | CONFIDENCE_WITH_TARGET_FIRST | 1 | False | resources/virtual_k8s/properties/default_flavor_ref/index.md#schema-default_flavor_ref--name | resources/virtual_k8s/properties/default_flavor_ref/index.md#schema-default_flavor_ref--name |
| A036 | ALIAS_ROOT_FALLTHROUGH | None | True | resources/virtual_k8s/properties/vsite_refs/index.md#schema-vsite_refs--namespace | resources/virtual_k8s/properties/index.md#schema-namespace |
| A037 | OWNER_IDENTITY_ALIAS | None | True | resources/dns_load_balancer/properties/index.md#schema-record_type | resources/dns_proxy/properties/origin_servers/health_checks/health_check/dns_health_check/index.md#schema-origin_servers--health_checks--health_check--dns_health_check--expected_record_type |
| A038 | CONFIDENCE_WITH_TARGET_FIRST | 1 | False | resources/dns_load_balancer/properties/fallback_pool/index.md#schema-fallback_pool--name | resources/dns_load_balancer/properties/fallback_pool/index.md#schema-fallback_pool--name |
| A039 | BLOCK_FIELD_INTENT | None | True | resources/tcp_loadbalancer/properties/index.md#schema-idle_timeout | resources/tcp_loadbalancer/properties/tcp/index.md#section |
| A040 | BLOCK_FIELD_INTENT | None | True | resources/udp_loadbalancer/properties/index.md#schema-idle_timeout | resources/udp_loadbalancer/properties/udp/index.md#section |
| A041 | CONFIDENCE_WITH_TARGET_FIRST | 1 | False | resources/udp_loadbalancer/properties/index.md#schema-listen_port | resources/udp_loadbalancer/properties/index.md#schema-listen_port |
| A042 | BLOCK_FIELD_INTENT | None | True | resources/tcp_loadbalancer/properties/index.md#schema-domains | resources/tcp_loadbalancer/properties/tcp/index.md#section |
| A043 | BLOCK_FIELD_INTENT | None | False | resources/http_loadbalancer/properties/index.md#schema-add_location | resources/http_loadbalancer/properties/http/index.md#section |
| A044 | BLOCK_FIELD_INTENT | None | False | resources/http_loadbalancer/properties/index.md#schema-domains | resources/http_loadbalancer/properties/http/index.md#section |
| A045 | SEMANTIC_INTENT_RANKING | None | False | resources/authentication/properties/cookie_params/auth_hmac/prim_key/blindfold_secret_info/index.md#schema-cookie_params--auth_hmac--prim_key--blindfold_secret_info--location | resources/authentication/properties/cookie_params/auth_hmac/index.md#schema-cookie_params--auth_hmac--sec_key_expiry |
| A046 | RANKING_AND_CONFIDENCE_TOP5 | 5 | False | resources/authentication/properties/cookie_params/auth_hmac/prim_key/clear_secret_info/index.md#schema-cookie_params--auth_hmac--prim_key--clear_secret_info--url | resources/authentication/properties/cookie_params/auth_hmac/prim_key/blindfold_secret_info/index.md#schema-cookie_params--auth_hmac--prim_key--blindfold_secret_info--location |
| A047 | SEMANTIC_INTENT_RANKING | None | False | data-sources/network_regional_edges/properties/index.md#schema-regions | data-sources/network_regional_edges/index.md#minimal-configuration |
| A048 | RANKING_AND_CONFIDENCE_TOP5 | 3 | False | data-sources/network_regional_edges/properties/index.md#schema-cidr_blocks_by_region | data-sources/network_regional_edges/properties/index.md#schema-cidr_blocks |
| A049 | SEMANTIC_INTENT_RANKING | None | False | data-sources/network_regional_edges/properties/index.md#schema-source_entries | data-sources/discovery/properties/index.md#schema-annotations |
| A050 | RANKING_AND_CONFIDENCE_TOP5 | 2 | False | data-sources/network_cdn/properties/index.md#schema-cidr_blocks | data-sources/network_cdn/index.md#minimal-configuration |
| A051 | CONFIDENCE_WITH_TARGET_FIRST | 1 | False | data-sources/network_cdn/properties/index.md#schema-source_sha256 | data-sources/network_cdn/properties/index.md#schema-source_sha256 |
| A052 | OWNER_IDENTITY_ALIAS | None | True | data-sources/network_secondary_dns_zone_transfer/properties/index.md#schema-source_entries | data-sources/dns_zone/properties/secondary/index.md#section |
| A053 | CONFIDENCE_WITH_TARGET_FIRST | 1 | False | data-sources/network_bot_defense/properties/index.md#schema-domains | data-sources/network_bot_defense/properties/index.md#schema-domains |
| A054 | OWNER_IDENTITY_ALIAS | None | False | data-sources/network_customer_edge_egress/properties/index.md#schema-registration_addresses | data-sources/registration/properties/infra/hw_info/network/index.md#schema-infra--hw_info--network--ip_address |
| A055 | CONFIDENCE_WITH_TARGET_FIRST | 1 | False | data-sources/network_customer_edge_egress/properties/index.md#schema-domains | data-sources/network_customer_edge_egress/properties/index.md#schema-domains |
| A056 | SEMANTIC_INTENT_RANKING | None | False | data-sources/network_data_intelligence/properties/index.md#schema-regions | data-sources/network_data_intelligence/properties/index.md#schema-source_url |
| A057 | CONFIDENCE_WITH_TARGET_FIRST | 1 | False | data-sources/network_data_intelligence/properties/index.md#schema-cidr_blocks_by_region | data-sources/network_data_intelligence/properties/index.md#schema-cidr_blocks_by_region |
| A058 | OWNER_IDENTITY_ALIAS | None | False | data-sources/network_dnslb_health_checks/properties/index.md#schema-cidr_blocks | data-sources/dns_load_balancer/properties/response_cache/response_cache_parameters/index.md#schema-response_cache--response_cache_parameters--cache_cidr_ipv4 |
| A060 | RANKING_AND_CONFIDENCE_TOP5 | 2 | False | actions/access_active_sessions_terminate/properties/index.md#schema-ids | actions/access_active_sessions_terminate/lifecycle/index.md#lifecycle |
| A065 | RANKING_AND_CONFIDENCE_TOP5 | 3 | False | resources/network_interface/properties/dedicated_interface/index.md#schema-dedicated_interface--mtu | resources/network_interface/properties/dedicated_interface/cluster/index.md#section |
| A068 | SEMANTIC_INTENT_RANKING | None | False | resources/bgp/properties/bgp_parameters/index.md#schema-bgp_parameters--asn | resources/bgp/properties/where/site/index.md#schema-where--site--network_type |
| A070 | BLOCK_FIELD_INTENT | None | True | resources/tunnel/properties/index.md#schema-tunnel_type | resources/tunnel/properties/params/ipsec/index.md#section |
| A071 | ALIAS_ROOT_FALLTHROUGH | None | True | resources/ip_prefix_set/properties/ipv4_prefixes/index.md#schema-ipv4_prefixes--description_spec | resources/ip_prefix_set/properties/index.md#schema-description |
| A072 | RANKING_AND_CONFIDENCE_TOP5 | 2 | False | resources/healthcheck/properties/http_health_check/index.md#schema-http_health_check--path | resources/healthcheck/properties/http_health_check/index.md#schema-http_health_check--expected_response |
| A073 | CONFIDENCE_WITH_TARGET_FIRST | 1 | False | resources/healthcheck/properties/http_health_check/index.md#schema-http_health_check--expected_response | resources/healthcheck/properties/http_health_check/index.md#schema-http_health_check--expected_response |
| A074 | CONFIDENCE_WITH_TARGET_FIRST | 1 | False | resources/healthcheck/properties/http_health_check/index.md#schema-http_health_check--expected_status_codes | resources/healthcheck/properties/http_health_check/index.md#schema-http_health_check--expected_status_codes |
| A076 | CONFIDENCE_WITH_TARGET_FIRST | 1 | False | resources/healthcheck/properties/index.md#schema-interval | resources/healthcheck/properties/index.md#schema-interval |
| A078 | ALIAS_ROOT_FALLTHROUGH | None | True | resources/aws_vpc_site/properties/aws_cred/index.md#schema-aws_cred--name | resources/aws_vpc_site/properties/index.md#schema-name |
| A079 | ALIAS_ROOT_FALLTHROUGH | None | True | resources/azure_vnet_site/properties/azure_cred/index.md#schema-azure_cred--name | resources/azure_vnet_site/properties/index.md#schema-name |
| A081 | CONFIDENCE_WITH_TARGET_FIRST | 1 | False | resources/secret_management_access/properties/access_info/index.md#schema-access_info--server_endpoint | resources/secret_management_access/properties/access_info/index.md#schema-access_info--server_endpoint |
| A082 | ALIAS_ROOT_FALLTHROUGH | None | True | resources/secret_management_access/properties/index.md#schema-provider_name | resources/secret_management_access/properties/index.md#schema-name |
| A084 | BLOCK_FIELD_INTENT | None | True | resources/service_policy/properties/allow_list/index.md#schema-allow_list--tls_fingerprint_values | resources/service_policy/properties/allow_list/index.md#section |
| A088 | ALIAS_ROOT_FALLTHROUGH | None | True | resources/aws_vpc_site/properties/ingress_egress_gw/inside_static_routes/static_route_list/custom_static_route/nexthop/nexthop_address/ipv6/index.md#schema-ingress_egress_gw--inside_static_routes--static_route_list--custom_static_route--nexthop--nexthop_address--ipv6--addr | resources/aws_vpc_site/properties/index.md#schema-address |
| A089 | BLOCK_FIELD_INTENT | None | True | resources/http_loadbalancer/properties/bot_defense/policy/protected_app_endpoints/flow_label/authentication/login/transaction_result/success_conditions/index.md#schema-bot_defense--policy--protected_app_endpoints--flow_label--authentication--login--transaction_result--success_conditions--regex_values | resources/http_loadbalancer/properties/bot_defense/policy/protected_app_endpoints/flow_label/authentication/login/transaction_result/success_conditions/index.md#section |
| A090 | SEMANTIC_INTENT_RANKING | None | False | resources/azure_vnet_site/properties/ingress_egress_gw/hub/express_route_enabled/connections/other_subscription/authorized_key/blindfold_secret_info/index.md#schema-ingress_egress_gw--hub--express_route_enabled--connections--other_subscription--authorized_key--blindfold_secret_info--location | resources/azure_vnet_site/properties/vnet/existing_vnet/index.md#section |
| A091 | SEMANTIC_INTENT_RANKING | None | False | resources/bigip_http_proxy/properties/origin_pools/pools/origin_servers/origin_servers/k8s_service/site_locator/site/index.md#schema-origin_pools--pools--origin_servers--origin_servers--k8s_service--site_locator--site--name | resources/bigip_http_proxy/properties/origin_pools/pools/origin_servers/automatic_port/index.md#section |
| A093 | RANKING_AND_CONFIDENCE_TOP5 | 4 | False | resources/voltstack_site/properties/custom_network_config/interface_list/interfaces/ethernet_interface/dhcp_server/dhcp_networks/pools/index.md#schema-custom_network_config--interface_list--interfaces--ethernet_interface--dhcp_server--dhcp_networks--pools--start_ip | resources/voltstack_site/properties/custom_network_config/interface_list/interfaces/ethernet_interface/dhcp_server/dhcp_networks/pools/index.md#schema-custom_network_config--interface_list--interfaces--ethernet_interface--dhcp_server--dhcp_networks--pools--exclude |
| A094 | RANKING_AND_CONFIDENCE_TOP5 | 3 | False | resources/fleet/properties/storage_device_list/storage_devices/netapp_trident/netapp_backend_ontap_san/use_chap/chap_initiator_secret/clear_secret_info/index.md#schema-storage_device_list--storage_devices--netapp_trident--netapp_backend_ontap_san--use_chap--chap_initiator_secret--clear_secret_info--url | resources/fleet/properties/storage_device_list/storage_devices/netapp_trident/netapp_backend_ontap_san/use_chap/chap_initiator_secret/clear_secret_info/index.md#schema-storage_device_list--storage_devices--netapp_trident--netapp_backend_ontap_san--use_chap--chap_initiator_secret--clear_secret_info--provider_ref |
| A095 | ALIAS_ROOT_FALLTHROUGH | None | True | resources/gcp_vpc_site/properties/ingress_egress_gw/inside_static_routes/static_route_list/custom_static_route/nexthop/nexthop_address/ipv6/index.md#schema-ingress_egress_gw--inside_static_routes--static_route_list--custom_static_route--nexthop--nexthop_address--ipv6--addr | resources/gcp_vpc_site/properties/index.md#schema-address |
| A096 | ALIAS_ROOT_FALLTHROUGH | None | True | resources/voltstack_site/properties/custom_network_config/interface_list/interfaces/ethernet_interface/ipv6_auto_config/router/dns_config/configured_list/index.md#schema-custom_network_config--interface_list--interfaces--ethernet_interface--ipv6_auto_config--router--dns_config--configured_list--dns_list | resources/voltstack_site/properties/index.md#schema-address |
| A097 | BLOCK_FIELD_INTENT | None | False | resources/http_loadbalancer/properties/enable_api_discovery/api_crawler/api_crawler_config/domains/simple_login/password/blindfold_secret_info/index.md#schema-enable_api_discovery--api_crawler--api_crawler_config--domains--simple_login--password--blindfold_secret_info--decryption_provider | resources/http_loadbalancer/properties/enable_api_discovery/api_crawler/api_crawler_config/domains/simple_login/password/index.md#section |
| A098 | ALIAS_ROOT_FALLTHROUGH | None | True | resources/securemesh_site/properties/custom_network_config/interface_list/interfaces/ethernet_interface/dhcp_server/dhcp_networks/pools/index.md#schema-custom_network_config--interface_list--interfaces--ethernet_interface--dhcp_server--dhcp_networks--pools--end_ip | resources/securemesh_site/properties/index.md#schema-address |
| A099 | CONFIDENCE_WITH_TARGET_FIRST | 1 | False | resources/securemesh_site_v2/properties/baremetal/not_managed/node_list/interface_list/ipv6_auto_config/router/dns_config/configured_list/index.md#schema-baremetal--not_managed--node_list--interface_list--ipv6_auto_config--router--dns_config--configured_list--dns_list | resources/securemesh_site_v2/properties/baremetal/not_managed/node_list/interface_list/ipv6_auto_config/router/dns_config/configured_list/index.md#schema-baremetal--not_managed--node_list--interface_list--ipv6_auto_config--router--dns_config--configured_list--dns_list |
| A100 | SEMANTIC_INTENT_RANKING | None | False | resources/voltstack_site/properties/custom_network_config/interface_list/interfaces/ethernet_interface/ipv6_auto_config/router/stateful/automatic_from_end/index.md#section | resources/voltstack_site/properties/custom_network_config/interface_list/interfaces/ethernet_interface/ipv6_auto_config/router/stateful/dhcp_networks/pools/index.md#schema-custom_network_config--interface_list--interfaces--ethernet_interface--ipv6_auto_config--router--stateful--dhcp_networks--pools--start_ip |
| A101 | BLOCK_FIELD_INTENT | None | True | resources/workload/properties/service/advertise_options/advertise_on_public/multi_ports/ports/http_loadbalancer/specific_routes/routes/redirect_route/route_redirect/index.md#schema-service--advertise_options--advertise_on_public--multi_ports--ports--http_loadbalancer--specific_routes--routes--redirect_route--route_redirect--proto_redirect | resources/workload/properties/service/index.md#section |
| A102 | ALIAS_ROOT_FALLTHROUGH | None | True | resources/aws_vpc_site/properties/ingress_egress_gw/outside_static_routes/static_route_list/custom_static_route/nexthop/nexthop_address/dual_stack/ipv4/index.md#schema-ingress_egress_gw--outside_static_routes--static_route_list--custom_static_route--nexthop--nexthop_address--dual_stack--ipv4--addr | resources/aws_vpc_site/properties/index.md#schema-address |
| A103 | CONFIDENCE_WITH_TARGET_FIRST | 1 | False | resources/voltstack_site/properties/custom_network_config/interface_list/interfaces/ethernet_interface/ipv6_auto_config/router/stateful/dhcp_networks/index.md#schema-custom_network_config--interface_list--interfaces--ethernet_interface--ipv6_auto_config--router--stateful--dhcp_networks--pool_settings | resources/voltstack_site/properties/custom_network_config/interface_list/interfaces/ethernet_interface/ipv6_auto_config/router/stateful/dhcp_networks/index.md#schema-custom_network_config--interface_list--interfaces--ethernet_interface--ipv6_auto_config--router--stateful--dhcp_networks--pool_settings |
| A104 | BLOCK_FIELD_INTENT | None | True | resources/azure_vnet_site/properties/ingress_egress_gw_ar/hub/express_route_enabled/connections/other_subscription/authorized_key/clear_secret_info/index.md#schema-ingress_egress_gw_ar--hub--express_route_enabled--connections--other_subscription--authorized_key--clear_secret_info--provider_ref | resources/azure_vnet_site/properties/ingress_egress_gw_ar/index.md#section |
| A105 | BLOCK_FIELD_INTENT | None | True | resources/securemesh_site_v2/properties/aws/not_managed/node_list/interface_list/dhcp_server/dhcp_networks/pools/index.md#schema-aws--not_managed--node_list--interface_list--dhcp_server--dhcp_networks--pools--start_ip | resources/securemesh_site_v2/properties/aws/index.md#section |
| A106 | SEMANTIC_INTENT_RANKING | None | False | resources/bigip_http_proxy/properties/origin_pools/pools/origin_servers/origin_servers/private_ip/site_locator/virtual_site/index.md#schema-origin_pools--pools--origin_servers--origin_servers--private_ip--site_locator--virtual_site--namespace | resources/bigip_http_proxy/properties/origin_pools/pools/origin_servers/automatic_port/index.md#section |
| A107 | BLOCK_FIELD_INTENT | None | True | resources/securemesh_site_v2/properties/aws/not_managed/node_list/interface_list/dhcp_server/dhcp_networks/pools/index.md#schema-aws--not_managed--node_list--interface_list--dhcp_server--dhcp_networks--pools--exclude | resources/securemesh_site_v2/properties/aws/index.md#section |
| A109 | RANKING_AND_CONFIDENCE_TOP5 | 2 | False | resources/fleet/properties/storage_device_list/storage_devices/netapp_trident/netapp_backend_ontap_san/use_chap/chap_target_initiator_secret/blindfold_secret_info/index.md#schema-storage_device_list--storage_devices--netapp_trident--netapp_backend_ontap_san--use_chap--chap_target_initiator_secret--blindfold_secret_info--decryption_provider | resources/fleet/properties/storage_device_list/storage_devices/netapp_trident/netapp_backend_ontap_san/use_chap/chap_target_initiator_secret/blindfold_secret_info/index.md#schema-storage_device_list--storage_devices--netapp_trident--netapp_backend_ontap_san--use_chap--chap_target_initiator_secret--blindfold_secret_info--location |
| A110 | ALIAS_ROOT_FALLTHROUGH | None | True | resources/gcp_vpc_site/properties/ingress_egress_gw/outside_static_routes/static_route_list/custom_static_route/nexthop/nexthop_address/dual_stack/ipv4/index.md#schema-ingress_egress_gw--outside_static_routes--static_route_list--custom_static_route--nexthop--nexthop_address--dual_stack--ipv4--addr | resources/gcp_vpc_site/properties/index.md#schema-address |
| A111 | CONFIDENCE_WITH_TARGET_FIRST | 1 | False | resources/http_loadbalancer/properties/single_lb_app/enable_discovery/api_crawler/api_crawler_config/domains/simple_login/password/clear_secret_info/index.md#schema-single_lb_app--enable_discovery--api_crawler--api_crawler_config--domains--simple_login--password--clear_secret_info--url | resources/http_loadbalancer/properties/single_lb_app/enable_discovery/api_crawler/api_crawler_config/domains/simple_login/password/clear_secret_info/index.md#schema-single_lb_app--enable_discovery--api_crawler--api_crawler_config--domains--simple_login--password--clear_secret_info--url |
| A112 | ALIAS_ROOT_FALLTHROUGH | None | True | resources/securemesh_site/properties/custom_network_config/interface_list/interfaces/ethernet_interface/ipv6_auto_config/router/dns_config/local_dns/index.md#schema-custom_network_config--interface_list--interfaces--ethernet_interface--ipv6_auto_config--router--dns_config--local_dns--configured_address | resources/securemesh_site/properties/index.md#schema-address |
| A113 | RANKING_AND_CONFIDENCE_TOP5 | 5 | False | resources/securemesh_site_v2/properties/gcp/not_managed/node_list/interface_list/ipv6_auto_config/router/stateful/automatic_from_start/index.md#section | resources/securemesh_site_v2/properties/gcp/not_managed/node_list/interface_list/ipv6_auto_config/router/stateful/dhcp_networks/pools/index.md#schema-gcp--not_managed--node_list--interface_list--ipv6_auto_config--router--stateful--dhcp_networks--pools--start_ip |
| A114 | SEMANTIC_INTENT_RANKING | None | False | resources/workload/properties/stateful_service/advertise_options/advertise_on_public/multi_ports/ports/http_loadbalancer/https_auto_cert/index.md#schema-stateful_service--advertise_options--advertise_on_public--multi_ports--ports--http_loadbalancer--https_auto_cert--append_server_name | resources/workload/properties/stateful_service/advertise_options/advertise_on_public/multi_ports/ports/http_loadbalancer/https/tls_parameters/tls_certificates/index.md#schema-stateful_service--advertise_options--advertise_on_public--multi_ports--ports--http_loadbalancer--https--tls_parameters--tls_certificates--certificate_url |
| A115 | CONFIDENCE_WITH_TARGET_FIRST | 1 | False | resources/workload/properties/service/advertise_options/advertise_on_public/port/http_loadbalancer/https/tls_parameters/tls_certificates/index.md#schema-service--advertise_options--advertise_on_public--port--http_loadbalancer--https--tls_parameters--tls_certificates--certificate_url | resources/workload/properties/service/advertise_options/advertise_on_public/port/http_loadbalancer/https/tls_parameters/tls_certificates/index.md#schema-service--advertise_options--advertise_on_public--port--http_loadbalancer--https--tls_parameters--tls_certificates--certificate_url |
| A116 | BLOCK_FIELD_INTENT | None | True | resources/aws_vpc_site/properties/voltstack_cluster/outside_static_routes/static_route_list/custom_static_route/nexthop/nexthop_address/dual_stack/ipv6/index.md#schema-voltstack_cluster--outside_static_routes--static_route_list--custom_static_route--nexthop--nexthop_address--dual_stack--ipv6--addr | resources/aws_vpc_site/properties/voltstack_cluster/index.md#section |
| A117 | ALIAS_ROOT_FALLTHROUGH | None | True | resources/azure_vnet_site/properties/ingress_egress_gw/inside_static_routes/static_route_list/custom_static_route/nexthop/nexthop_address/dual_stack/ipv6/index.md#schema-ingress_egress_gw--inside_static_routes--static_route_list--custom_static_route--nexthop--nexthop_address--dual_stack--ipv6--addr | resources/azure_vnet_site/properties/index.md#schema-address |
| A118 | TASK_ROOT_PREEMPTION | None | True | resources/bigip_http_proxy/properties/origin_pools/pools/origin_servers/origin_servers/k8s_service/snat_pool/snat_pool/index.md#schema-origin_pools--pools--origin_servers--origin_servers--k8s_service--snat_pool--snat_pool--prefixes | resources/bigip_http_proxy/index.md#minimal-configuration |
| A120 | RANKING_AND_CONFIDENCE_TOP5 | 2 | False | resources/fleet/properties/storage_device_list/storage_devices/pure_service_orchestrator/arrays/flash_array/flash_arrays/api_token/blindfold_secret_info/index.md#schema-storage_device_list--storage_devices--pure_service_orchestrator--arrays--flash_array--flash_arrays--api_token--blindfold_secret_info--store_provider | resources/fleet/properties/storage_device_list/storage_devices/pure_service_orchestrator/arrays/flash_array/flash_arrays/index.md#section |
| A121 | BLOCK_FIELD_INTENT | None | True | resources/gcp_vpc_site/properties/voltstack_cluster/outside_static_routes/static_route_list/custom_static_route/nexthop/nexthop_address/dual_stack/ipv6/index.md#schema-voltstack_cluster--outside_static_routes--static_route_list--custom_static_route--nexthop--nexthop_address--dual_stack--ipv6--addr | resources/gcp_vpc_site/properties/voltstack_cluster/index.md#section |
| A122 | CONFIDENCE_WITH_TARGET_FIRST | 1 | False | resources/securemesh_site/properties/custom_network_config/interface_list/interfaces/ethernet_interface/ipv6_auto_config/router/stateful/dhcp_networks/index.md#schema-custom_network_config--interface_list--interfaces--ethernet_interface--ipv6_auto_config--router--stateful--dhcp_networks--pool_settings | resources/securemesh_site/properties/custom_network_config/interface_list/interfaces/ethernet_interface/ipv6_auto_config/router/stateful/dhcp_networks/index.md#schema-custom_network_config--interface_list--interfaces--ethernet_interface--ipv6_auto_config--router--stateful--dhcp_networks--pool_settings |
| A123 | CONFIDENCE_WITH_TARGET_FIRST | 1 | False | resources/securemesh_site_v2/properties/kvm/not_managed/node_list/interface_list/ipv6_auto_config/router/stateful/dhcp_networks/index.md#schema-kvm--not_managed--node_list--interface_list--ipv6_auto_config--router--stateful--dhcp_networks--network_prefix | resources/securemesh_site_v2/properties/kvm/not_managed/node_list/interface_list/ipv6_auto_config/router/stateful/dhcp_networks/index.md#schema-kvm--not_managed--node_list--interface_list--ipv6_auto_config--router--stateful--dhcp_networks--network_prefix |
| A124 | BLOCK_FIELD_INTENT | None | True | resources/workload/properties/service/advertise_options/advertise_on_public/port/http_loadbalancer/https/tls_parameters/tls_config/custom_security/index.md#schema-service--advertise_options--advertise_on_public--port--http_loadbalancer--https--tls_parameters--tls_config--custom_security--min_version | resources/workload/properties/service/index.md#section |
| A125 | BLOCK_FIELD_INTENT | None | True | resources/workload/properties/service/advertise_options/advertise_on_public/port/http_loadbalancer/specific_routes/routes/simple_route/path/index.md#schema-service--advertise_options--advertise_on_public--port--http_loadbalancer--specific_routes--routes--simple_route--path--path | resources/workload/properties/service/index.md#section |
| A126 | BLOCK_FIELD_INTENT | None | True | resources/azure_vnet_site/properties/voltstack_cluster_ar/outside_static_routes/static_route_list/custom_static_route/nexthop/nexthop_address/ipv4/index.md#schema-voltstack_cluster_ar--outside_static_routes--static_route_list--custom_static_route--nexthop--nexthop_address--ipv4--addr | resources/azure_vnet_site/properties/voltstack_cluster_ar/index.md#section |
| A127 | CONFIDENCE_WITH_TARGET_FIRST | 1 | False | resources/bigip_http_proxy/properties/origin_pools/pools/origin_servers/origin_servers/private_ip/site_locator/site/index.md#schema-origin_pools--pools--origin_servers--origin_servers--private_ip--site_locator--site--tenant | resources/bigip_http_proxy/properties/origin_pools/pools/origin_servers/origin_servers/private_ip/site_locator/site/index.md#schema-origin_pools--pools--origin_servers--origin_servers--private_ip--site_locator--site--tenant |
| A128 | OWNER_IDENTITY_ALIAS | None | True | resources/workload/properties/service/advertise_options/advertise_on_public/port/http_loadbalancer/https/tls_cert_params/use_mtls/index.md#schema-service--advertise_options--advertise_on_public--port--http_loadbalancer--https--tls_cert_params--use_mtls--client_certificate_optional | resources/http_loadbalancer/properties/https/tls_cert_params/certificates/index.md#section |
| A130 | SOURCE_LABEL_BRANCH_EXCLUSION | 2 | False | resources/voltstack_site/properties/custom_storage_config/storage_device_list/storage_devices/netapp_trident/netapp_backend_ontap_san/storage/volume_defaults/index.md#schema-custom_storage_config--storage_device_list--storage_devices--netapp_trident--netapp_backend_ontap_san--storage--volume_defaults--encryption | resources/voltstack_site/properties/custom_storage_config/storage_device_list/storage_devices/netapp_trident/netapp_backend_ontap_san/volume_defaults/index.md#schema-custom_storage_config--storage_device_list--storage_devices--netapp_trident--netapp_backend_ontap_san--volume_defaults--encryption |
| A131 | RANKING_AND_CONFIDENCE_TOP5 | 3 | False | resources/fleet/properties/storage_device_list/storage_devices/pure_service_orchestrator/arrays/flash_blade/flash_blades/api_token/clear_secret_info/index.md#schema-storage_device_list--storage_devices--pure_service_orchestrator--arrays--flash_blade--flash_blades--api_token--clear_secret_info--provider_ref | resources/fleet/properties/storage_device_list/storage_devices/pure_service_orchestrator/arrays/flash_array/flash_arrays/api_token/blindfold_secret_info/index.md#schema-storage_device_list--storage_devices--pure_service_orchestrator--arrays--flash_array--flash_arrays--api_token--blindfold_secret_info--location |
| A132 | RANKING_AND_CONFIDENCE_TOP5 | 2 | False | resources/securemesh_site/properties/custom_network_config/interface_list/interfaces/ethernet_interface/ipv6_auto_config/router/stateful/interface_ip_map/index.md#schema-custom_network_config--interface_list--interfaces--ethernet_interface--ipv6_auto_config--router--stateful--interface_ip_map--interface_ip_map | resources/securemesh_site/properties/custom_network_config/interface_list/interfaces/ethernet_interface/ipv6_auto_config/router/stateful/interface_ip_map/index.md#section |
| A133 | OWNER_IDENTITY_ALIAS | None | False | resources/securemesh_site_v2/properties/local_vrf/slo_config/static_routes/static_routes/node_interface/list/interface/index.md#schema-local_vrf--slo_config--static_routes--static_routes--node_interface--list--interface--uid | resources/route/properties/routes/route_destination/regex_rewrite/index.md#schema-routes--route_destination--regex_rewrite--pattern |
| A134 | SOURCE_LABEL_BRANCH_EXCLUSION | 2 | False | resources/voltstack_site/properties/custom_storage_config/storage_device_list/storage_devices/netapp_trident/netapp_backend_ontap_san/storage/volume_defaults/index.md#schema-custom_storage_config--storage_device_list--storage_devices--netapp_trident--netapp_backend_ontap_san--storage--volume_defaults--split_on_clone | resources/voltstack_site/properties/custom_storage_config/storage_device_list/storage_devices/netapp_trident/netapp_backend_ontap_san/volume_defaults/index.md#schema-custom_storage_config--storage_device_list--storage_devices--netapp_trident--netapp_backend_ontap_san--volume_defaults--split_on_clone |
