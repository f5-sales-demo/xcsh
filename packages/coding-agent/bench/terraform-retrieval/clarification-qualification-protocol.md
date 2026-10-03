# Revised Terraform Retrieval Benchmark Qualification Protocol

**Status:** Proposal pending independent freeze  
*(Scoring design proposal only; no claim suite or implementation qualifies)*  
**Predecessor Document:** `protocol.md` (SHA256: `5d4b817b0e33e500e02d94350de25e83198463542f6f397dc0dbff34c706f315`)

---

## 1. Scope, Benchmark Suite Composition, and Preserved User Gate

This protocol specifies the qualification scoring design for a frozen, held-out Terraform retrieval benchmark. The benchmark evaluates retrieval accuracy, structured ambiguity clarification, filter preservation, documentation grounding, and execution claim veracity.

### 1.1. Benchmark Suite Composition
The benchmark suite consists of **200 cases** partitioned into three distinct operational categories:
- **140 Answerable Cases ($\mathcal{D}_{\text{answerable}}$):** Cases where the user query is uniquely answerable from documented evidence in `documentation/`, mapping to a unique destination leaf.
- **40 Ambiguous Cases ($\mathcal{D}_{\text{ambig}}$):** Legitimate ambiguity cases with multiple valid destinations, partitioned into flat ambiguity ($\le 5$ destinations) and hierarchical decision-tree ambiguity ($> 5$ destinations).
- **20 Control Cases ($\mathcal{D}_{\text{ctrl}}$):** Boundary verification cases, including negative controls (unsupported features, non-existent arguments, invalid cross-provider attributes) and ordinary documentation discovery cases.

A representative held-out **Model Subset of 40 cases** is defined with proportional representation: **28 answerable, 8 ambiguous, and 4 controls** (28/8/4).

### 1.2. Preserved Mandatory User Gate
A model qualifies if and only if **all five** gate criteria are satisfied simultaneously:

1. **Overall Retrieval Accuracy:** $\ge 95.0\%$ overall accuracy across all 200 cases in the suite ($A_{\text{overall}} \ge 0.95$), where answerable cases achieve exact leaf
selection, ambiguous cases achieve justified clarification and exact terminal leaf selection, and control cases demonstrate correct unsupported-rejection or ordinary-discovery
behavior. The denominator is strictly 200.
2. **Answerable Exact Leaf Accuracy:** $\ge 95.0\%$ correct exact leaf selection on uniquely answerable cases ($A_{\text{answerable}} \ge 0.95$ across the 140 answerable cases).
3. **Answerable Candidate Coverage:** $100.0\%$ of answerable expected destinations must appear within the top 5 retrieval candidates ($R_{\text{answerable, top5}} = 1.00$). Every answerable target destination must be within the top five.
4. **Zero Unsupported Field Claims:** Exactly zero invented, hallucinated, deprecated, or ungrounded fields, attributes, blocks, or documentation anchors across all interaction turns and all cases ($U_{\text{total}} = 0$).
5. **Zero False Live Apply Claims:** Exactly zero unverified or false assertions claiming configuration application, execution against live infrastructure, or validation against runtime state ($F_{\text{total}} = 0$).

No relaxed gates, score rounding, or retrospective qualification claims on exposed suites are permitted.

---

## 2. Canonical Source Boundary and Address Identifiers

1. **Exact Source Boundary (`documentation/` only):** Canonical Markdown files located exclusively within the `documentation/` directory and their verified `xcsh_docs` entity graph, relationships, and section anchors constitute the sole source of truth for the benchmark. No documents or data outside `documentation/` belong to the benchmark corpus.
2. **No Execution or Schema Export Required:** The benchmark does not require live Terraform binary execution, terraform apply, network connectivity, or provider schema JSON exports.
3. **Preservation of Existing Destinations:** Ground-truth destinations and retrieval targets are preserved as exact `xcsh://` URIs (e.g., `xcsh://<namespace>/<resource_or_guide>#<anchor>`). No synthetic or invented `provider::` URIs are permitted.
4. **Source-Bound Anchors:** Permitted branches and role/node intermediate targets must correspond to verified identities and section anchors defined in `xcsh_docs` within `documentation/`.
5. **Model Grounding Requirement:** The model's actual citations, generated HCL blocks, and tool execution traces must be strictly grounded in `documentation/` and verified `xcsh_docs` anchors. Any citation to non-existent anchors or generation of ungrounded arguments is scored as an unsupported field claim.

---

## 3. Case Typology and Behavioral Requirements

### 3.1. Answerable Cases (140 cases)
- **Documented Evidence Rule:** Cases answerable from documented evidence in `documentation/` must never require destination clarification.
- **Scoring Requirements:**
  - The first selected candidate (Top-1) must be the exact expected destination leaf.
  - The expected destination leaf must appear within the top 5 retrieval candidates.
  - **Answerable Clarification is Failure:** Hierarchy cannot substitute for a uniquely answerable leaf. If the model emits an undecided status, asks a clarification question to identify the destination, or initiates a decision tree on an answerable case, the case scores $0$ (Answerable Failure).
  - **Post-Retrieval HCL Parameter Prompting:** Once the correct destination leaf has been successfully identified and selected in Top-1 with Top-5 candidate inclusion, the model
  may prompt the user for user-specific HCL configuration values (such as resource names, IP ranges, or account-specific identifiers) to complete code generation. Prompting for
  user-specific values after correct destination selection must **not** be penalized as destination clarification.
  - Zero unsupported field claims and zero false live apply claims.

### 3.2. Flat Ambiguity Cases ($\le 5$ destinations)
- **Behavior:** The query is legitimately ambiguous among $2 \le K \le 5$ equivalent canonical destinations documented in `documentation/`.
- **Scoring Requirements:**
  - Initial response must be undecided and present all $K$ valid destinations within its top-5 candidate list ($K \le 5$).
  - **Premature Ambiguous Guess is Failure:** If the model prematurely outputs a single leaf guess before disambiguation is supplied, the case scores $0$.
  - All query and caller filters must be strictly preserved.
  - Zero unsupported field claims and zero false live apply claims.

### 3.3. Hierarchical Decision-Tree Ambiguity Cases ($> 5$ destinations)
- **Behavior:** The query is legitimately ambiguous among $K > 5$ equivalent canonical destinations sharing common functional roles or schema subtrees in `documentation/`.
- **Scoring Requirements:**
  - **Initial Undecided Status:** The initial response must be undecided. Premature leaf guessing scores $0$.
  - **Branching Bounds:** The clarification presents at least 2 and at most 5 ($2 \le B \le 5$) meaningful, mutually exclusive alternatives representing verified `xcsh_docs` role/node destinations.
  - **Filter Preservation:** The clarification must strictly preserve all caller and query filters.
  - **Exact Terminal Matching:** Upon evaluator continuation supplying any valid branch, the model must traverse the decision tree down to the terminal leaf. At the terminal step, the first selected candidate (Top-1) must match the expected destination leaf for that path, and that destination must appear within the top 5 candidates of that terminal step.
  - Zero unsupported field claims and zero false live apply claims across all turns.

### 3.4. Control Cases (20 cases)
- **Composition:** Includes negative controls (queries requesting unsupported arguments, non-existent provider features, deprecated blocks, or cross-provider confusion) and ordinary documentation discovery queries.
- **Scoring Requirements:**
  - **Negative Controls:** The model must accurately identify the requested feature or argument as unsupported based on `documentation/`, emit no fabricated parameters, and refrain from selecting a false positive leaf.
  - **Ordinary Discovery Controls:** The model must identify the correct general documentation section or accurately state the discovery boundary without hallucinating parameters.
  - **Overall Gate Participation:** Controls participate in the overall qualification gate ($A_{\text{overall}}$) with denominator 200. Failing to reject an unsupported feature, selecting a false positive leaf, generating unsupported field claims, or asserting false live apply results in case failure (Score = 0) and gate disqualification.

---

## 4. Freezing Protocol and Structural Verification

Prior to benchmark execution on held-out runs, the author and verifier must independently freeze:

1. **Authoritative `xcsh_docs` Corpus:** The canonical Markdown files in `documentation/`, verified entity graph, relationship maps, and section anchors are hashed with SHA256.
2. **Decision Tree Specifications (`trees.json`):**
   - For each ambiguous case $j \in \mathcal{D}_{\text{ambig}}$, the author declares a deterministic directed acyclic graph (DAG) anchored in `documentation/`.
   - **MECE Branch Partitions:** Branches at each decision node must be mutually exclusive and collectively exhaustive over the remaining candidate destination set.
   - **Necessity Verification:** Reviewers must establish that the omitted information partitioned by each decision node is genuinely required to disambiguate the destinations. Alternatives sharing only generic terminology do not qualify.
   - **Source-Bound Anchors:** Every intermediate branch destination must be bound to a verified identity or anchor in `xcsh_docs`.
3. **Finite Minimal Depth Bound ($D_{\max, j}$):**
   - A fixed two-turn cap is rejected as unsupported.
   - Each ambiguous case is assigned an independently reviewed minimal discriminating depth bound ($D_{\max, j}$) representing the exact minimum number of decisions needed to reach a unique leaf.
   - Traversal exceeding $D_{\max, j}$ fails immediately.
4. **Prohibition of Irrelevant Catalog Traversal:**
   - Navigating branches outside the frozen minimal decision graph, exploring irrelevant documentation sections, or issuing broad category enumerations triggers immediate case failure.

---

## 5. Retrieval Budgets and Context Constraints

Payload budgets apply strictly to retrieval operations and context injection, **not** to arbitrary model answer length:

1. **Retrieval Discovery / Hint Budget:** Payloads for retrieval discovery, intermediate branch listings, or hints must not exceed **$4\text{ KiB}$ ($4096\text{ bytes}$)** per tool call. Oversized discovery payloads fail validation.
2. **Retrieval Context Budget:** Complete documentation sections returned as context must not exceed **$16\text{ KiB}$ ($16384\text{ bytes}$)** per section. Context injection exceeding this limit is rejected.
3. **Model Response Length:** The model's conversational natural-language answer text is not artificially capped by the retrieval payload limits, provided it directly addresses the query or presents the required structured alternatives concisely.
4. **Model UAT Quality Standard:** User-facing clarification questions must be evaluated for semantic clarity, natural language fluency, and direct relevance. Opaque internal IDs or raw graph dumps fail UAT.

---

## 6. Multi-Turn Traversal and Scoring State Machine

```text
Answerable Case (i ∈ D_ans):
  Prompt q_i ──► Initial Response R_i
                   ├─► IsClarification == true (Destination)? ──► FAIL (Score = 0)
                   ├─► Top1(R_i) != t_i? ─────────────────────► FAIL (Score = 0)
                   ├─► t_i not in Top5(R_i)? ─────────────────► FAIL (Score = 0)
                   ├─► UnsupportedFields > 0? ────────────────► FAIL (Gate Disqualified)
                   ├─► FalseLiveApply > 0? ───────────────────► FAIL (Gate Disqualified)
                   └─► Destination Match + Top5 + Clean ──────► PASS (Score = 1)
                       (Post-retrieval user HCL value prompting permitted)

Ambiguous Case (j ∈ D_ambig):
  Prompt q_j ──► Initial Response R_j,0
                   ├─► IsClarification == false (Premature)? ─► FAIL (Score = 0)
                   ├─► Filter Drift / Dropped? ───────────────► FAIL (Score = 0)
                   ├─► Branches not MECE or > 5 or < 2? ──────► FAIL (Score = 0)
                   ├─► Off-Tree / Irrelevant Traversal? ──────► FAIL (Score = 0)
                   └─► For each valid path π in frozen DAG:
                         Traverse with Evaluator Branch Input
                         ├─► Depth > D_max,j? ────────────────► FAIL (Score = 0)
                         ├─► Terminal Top1 != t_j,π? ─────────► FAIL (Score = 0)
                         ├─► Terminal t_j,π not in Top5? ─────► FAIL (Score = 0)
                         └─► All Paths Terminal Exact Pass ───► PASS (Score = 1)

Control Case (c ∈ D_ctrl):
  Prompt q_c ──► Response R_c
                   ├─► Negative Control (Unsupported Feature / Argument):
                   │     ├─► Accurately identifies unsupported? ──► PASS (Score = 1)
                   │     └─► Hallucinates leaf / field? ──────────► FAIL (Score = 0)
                   └─► Ordinary Discovery:
                         ├─► Correct section / discovery bound? ──► PASS (Score = 1)
                         └─► Hallucinated destination? ───────────► FAIL (Score = 0)
```

---

## 7. Exact Mathematical Scoring Rules

Let $N_{\text{total}} = 200$, with $N_{\text{answerable}} = 140$, $N_{\text{ambig}} = 40$, and $N_{\text{ctrl}} = 20$.

### 7.1. Case-Level Score Functions

For answerable case $i \in \mathcal{D}_{\text{answerable}}$:
$$\text{Score}_{\text{answerable}, i} = \mathbb{I}(\neg \text{IsDestinationClarification}(R_i) \land \text{Top1}(R_i) = t_i \land t_i \in \text{Top5}(R_i) \land \text{Clean}(R_i)) \in \{0, 1\}$$

For flat ambiguous case $k \in \mathcal{D}_{\text{flat}}$ with candidate set $T_k$ ($2 \le |T_k| \le 5$):
$$\text{Score}_{\text{flat}, k} = \mathbb{I}(\text{IsClarification}(R_{k,0}) \land T_k \subseteq \text{Top5}(R_{k,0}) \land \text{FilterPreserved}(R_{k,0}) \land \text{Clean}(R_k)) \in \{0, 1\}$$

For decision-tree ambiguous case $j \in \mathcal{D}_{\text{tree}}$ with path set $\Pi_j$:
$$\text{InitialValid}_j = \mathbb{I}(\text{IsClarification}(R_{j,0}) \land 2 \le |\mathcal{A}_{j,0}| \le 5 \land \text{MECE}(\mathcal{A}_{j,0}) \land \text{FilterPreserved}(R_{j,0}))$$
$$\text{PathValid}_{j,\pi} = \mathbb{I}(\text{Depth}(\pi) \le D_{\max, j} \land \text{Top1}(R_{j,\pi,\text{term}}) = t_{j,\pi} \land t_{j,\pi} \in \text{Top5}(R_{j,\pi,\text{term}}) \land \text{Clean}(R_{j,\pi}))$$
$$\text{Score}_{\text{tree}, j} = \text{InitialValid}_j \times \prod_{\pi \in \Pi_j} \text{PathValid}_{j, \pi} \in \{0, 1\}$$

For control case $c \in \mathcal{D}_{\text{ctrl}}$ (including negative controls):
$$\text{Score}_{\text{ctrl}, c} = \mathbb{I}(\text{CorrectControlBehavior}(R_c) \land \text{Clean}(R_c)) \in \{0, 1\}$$

where $\text{Clean}(R) \iff (\text{UnsupportedFields}(R) = 0 \land \text{FalseLiveApply}(R) = 0)$.

### 7.2. Suite-Level Metrics and Gate Enforcement

1. **Answerable Exact Leaf Accuracy ($A_{\text{answerable}}$):**
   $$A_{\text{answerable}} = \frac{1}{140} \sum_{i=1}^{140} \text{Score}_{\text{answerable}, i} \ge 0.95 \quad (\ge 95.0\%)$$

2. **Answerable Candidate Top-5 Recall ($R_{\text{answerable, top5}}$):**
   $$R_{\text{answerable, top5}} = \frac{1}{140} \sum_{i=1}^{140} \mathbb{I}(t_i \in \text{Top5}(R_i) \land \neg \text{IsDestinationClarification}(R_i)) = 1.00 \quad (100.0\%)$$
   *(Every answerable target must be in the top five).*

3. **Overall Benchmark Accuracy ($A_{\text{overall}}$):**
   $$A_{\text{overall}} = \frac{\sum_{i=1}^{140} \text{Score}_{\text{answerable}, i} + \sum_{j=1}^{40} \text{Score}_{\text{ambig}, j} + \sum_{c=1}^{20} \text{Score}_{\text{ctrl}, c}}{200} \ge 0.95 \quad (\ge 95.0\%)$$
   *(Control denominator is strictly 200).*

4. **Zero Unsupported Field Claims ($U_{\text{total}}$):**
   $$U_{\text{total}} = \sum_{m=1}^{200} \text{UnsupportedFields}(m) = 0$$

5. **Zero False Live Apply Claims ($F_{\text{total}} = 0$):**
   $$F_{\text{total}} = \sum_{m=1}^{200} \text{FalseLiveApply}(m) = 0$$

All five criteria must be satisfied simultaneously for benchmark qualification.
