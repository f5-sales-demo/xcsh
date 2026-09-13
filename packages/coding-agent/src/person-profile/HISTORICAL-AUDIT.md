# Person awareness restoration audit for #3818

This audit compares repair `54d586d78` with xcsh
`b0fae945221c094cfda26f884970aa146e8f5370`, the parent of removal
`3f3a561b2`. Marketplace reference
`73064eb153fa50e48933f3060abe7e6622ad8e41` is the last marketplace commit
before that xcsh reference's timestamp. Source inspection used those pinned
revisions, not account data or conversation transcripts.

The restoration is incomplete. A canonical store and successful get operation do
not establish discovery parity. The historical implementation combined a saved
person profile, a separate saved computer profile, plugin account hints, Salesforce
business discovery, and automatic startup language discovery. These have different
lifecycles and must be assessed separately.

## Core person discovery and persistence

Historical source: [user-profile.ts](https://github.com/f5-sales-demo/xcsh/blob/b0fae945221c094cfda26f884970aa146e8f5370/packages/coding-agent/src/internal-urls/user-profile.ts)
and [profile-collectors.ts](https://github.com/f5-sales-demo/xcsh/blob/b0fae945221c094cfda26f884970aa146e8f5370/packages/coding-agent/src/internal-urls/profile-collectors.ts).

| Function or contract | Historical purpose and actual behavior | Repair assessment |
| --- | --- | --- |
| `UserProfile` | Identity, contact, employment, address, demographics, family, online identities, business role, partner, territories, quota, observations, source timestamps, field ownership. | Most fact families restored in a validated envelope. |
| `UserProfileObservation` | Free-form key/value, optional source and observation timestamp. | Narrowed to known person fields and mandatory inferred status. No model-facing observation operation exists. |
| `loadProfile` | Read one OS user's JSON; return empty on missing or malformed input. | Secure service read replaces it, but the legacy exported reader is absent. Malformed data now fails intact. |
| `saveProfile` | Stamp `updatedAt` and write the whole JSON document. | Atomic, revision-checked mutation replaces unrestricted whole-file writes. Legacy writer is absent intentionally; compatibility must not bypass ownership or approval. |
| `mergeProfile` | Fill missing scalars; union `sameAs`; populate absent languages. Object fields actually use whole-object first-wins despite a subfield-merge comment. | Replaced by ownership reconciliation. Multiple source identifiers still compete for one top-level `identifiers` field. |
| `seedProfile` | Run available collectors in order, merge, record source timestamps and per-source results, save. | Explicit `refresh` exists, but fresh sessions do not initiate it. |
| `reconcileProfile` | Refresh same-owner fields; preserve user and other-source ownership. `authoritativeFields` can replace existing **unowned** values. | Ownership restored; `authoritativeFields` is accepted and validated but unused. New profiles disallow unowned facts, so the old adoption case needs explicit migration semantics. |
| `reconcileFromCollectors` | Run **all available registered collectors**, reconcile their output, record source timestamps, save. | Runs only previously configured sources. Missing profiles have none. This changes first-run behavior. |
| `renderSeedReport` | Format collector status, contributed field names and errors. | Structured sanitized statuses replace it; durable per-source attempt/freshness status is absent. |
| `renderProfileMarkdown` | Render saved facts, observations and source freshness; provide an empty-profile seed hint. | JSON resource/tool replaces rendering. Empty state is explicit. |
| `formatAddress`, `hasValues`, `titleCase` | Presentation helpers for the preceding reports. | No independent discovery or persistence responsibility. |
| `runCli` | Execute a CLI with a killable timeout. | Restored with cancellation, bounded output and suppressed stderr. |
| `splitFullName` | First whitespace token becomes given name; remainder becomes family name. | Restored heuristic; not proof of a person's legal name structure. |
| Salesforce `available`, `collect`, `parseSalesforceUserRecord` | Detect authenticated CLI, resolve current username, query User record, map contact/employment/manager/address/ID. | Restored basic adapter. Invented employer fallback removed. Does not restore the richer plugin discovery below. |
| GitHub `available`, `collect`, `parseGithubUserJson` | Check authentication, call `gh api user`, map name, public email, bio, site, GitHub/Twitter IDs and links. | Restored. Did not enumerate private email addresses or all authenticated accounts. |
| Git `available`, `collect` | Read effective `user.name` and `user.email`, including project configuration. | Uses global configuration now to preserve the cross-project person boundary. |
| `detectDarwinLanguages`, `detectLinuxLanguages` | Read OS language preferences or locale environment. | Collector helpers restored. UI application path is missing. |
| `detectSystemFullName` and system `available`/`collect` | Read local account full name plus language candidates. Linux incorrectly selected the shell column as GECOS. | UID-based GECOS column-five fix restored. Machine hardware belongs to a different collector. |
| `PROFILE_COLLECTORS`, registry facade | Ordered Salesforce, GitHub, Git, system, then extensions. Facade avoided historical bundler recursion problems. | Service owns a map instead of a mutable shared array. |
| `registerProfileCollector`, `unregisterProfileCollector` | Append unique collector; remove by ID. Duplicate core IDs were silently skipped by extension registration. | Registration restored with stronger validation; unregister absent. Built-in Salesforce collision now throws and can abort plugin loading. |

## Startup, learning and retrieval

| Entry point | Historical behavior | Repair assessment |
| --- | --- | --- |
| `cli.ts` → `discoverAndApplyLanguage` | After settings initialization, skip when `XCSH_LOCALE` is set. Read person languages; otherwise collect system data, merge and **save the profile**, then map the first language to a supported UI locale. | This automatic discovery/save/application path was not restored. |
| `InteractiveMode.init` | Start person reconciliation and computer seeding in the background on TUI startup. | Common SDK registration is an improvement for interface parity, but configured-only reconciliation means a new store remains empty. |
| SDK system-prompt rebuild | Read saved profile, derive name, role/job title and employer; read computer profile and derive hardware hint. | Person values deliberately retrieved on demand instead. Initialization must still complete independently of the first person question. |
| Managed `Primary Human` prompt | Include compact saved identity; require `xcsh://user` for identity, communications and PII questions. | Mandatory capability guidance is restored, including custom prompt paths. |
| `xcsh://user` handler | Plain read loads saved data. `?seed=true` collects and writes, then returns profile/report. | Plain read and schema restored. Mutating read deliberately replaced by an approved explicit tool operation. |
| `xcsh://computer` handler | Plain read loads machine cache; `?refresh=true` collects and saves. | Excluded by the original repair plan; no accidental restoration should be claimed. |
| Conversational recording | The profile supported observations, but historical core call sites had no general conversation writer. | Explicit user facts use `update`; inferred observations have a distinct service and tool path. |

Historical entry points:
[language discovery](https://github.com/f5-sales-demo/xcsh/blob/b0fae945221c094cfda26f884970aa146e8f5370/packages/coding-agent/src/discovery/language.ts),
[interactive startup](https://github.com/f5-sales-demo/xcsh/blob/b0fae945221c094cfda26f884970aa146e8f5370/packages/coding-agent/src/modes/interactive-mode.ts),
[SDK](https://github.com/f5-sales-demo/xcsh/blob/b0fae945221c094cfda26f884970aa146e8f5370/packages/coding-agent/src/sdk.ts).

## Account plugins and Salesforce business discovery

| Plugin function or hook | Purpose and persistence boundary |
| --- | --- |
| AWS `before_agent_start` | Execute STS caller identity; inject account ID, ARN, active profile and region as hidden `aws_hint` session content. Does **not** call the person writer or register a person collector. |
| Azure `before_agent_start` | Execute `az account show`; inject subscription, tenant, user name/type and cloud as hidden `azure_hint` session content. Does **not** persist these in the person file. |
| AWS/Azure service-status `check` | Report CLI/authentication readiness. Fix commands launch supported login flows; they are not person discovery. |
| AWS/Azure account tools | On-demand account identity retrieval. An assumed role or service principal is not necessarily the human user. |
| GitHub `before_agent_start` | Inject repository, branch and URL. Separate from core `gh api user` person collection. |
| Plugin `session_start` hooks | Missing-CLI/authentication diagnostics. AWS/Azure identity injection happens before agent turns, not through person background reconciliation. |
| Salesforce `setLoadProfile`, `getLoadProfile`, `loadProfileSafe` | Inject/access the canonical legacy facts reader. Plugin fallback directly reads the old flat person JSON. The new envelope breaks that fallback. |
| Salesforce registered collector `available`, `collect` | Use cached context or Salesforce person ID; seed missing/stale context; map person-related results back into reconciliation. Requires a working reader and registration. |
| `loadSalesforceContext`, `saveSalesforceContext`, `salesforceContextIsStale` | Maintain a separate timestamped business-context cache, not the person document. |
| `runSfQuery`, `getOrgInfo`, `describeSObject` | Execute queries, resolve active org, discover schema and supported field metadata. |
| `territorySoqlPath`, `rankTerritoryFieldCandidates` | Identify queryable territory fields and relationship paths from actual org metadata. |
| `readPath`, `probeTerritoryField`, `pickBestTerritoryField` | Read nested query results, count candidate coverage, select by coverage then finer partition then lexical order. |
| `discoverTerritories` | Discover assigned pipeline territory values, compare team/total coverage, retain selected field and details. |
| `discoverAccounts` | Aggregate active customer accounts from the user's opportunity-team membership. These are business accounts, not login accounts. |
| `discoverSegmentations`, `discoverForecasts`, `discoverStages` | Discover actual product, forecast and stage vocabulary; do not assume every org uses defaults. |
| `discoverPipelineSummary`, `discoverTeamRoles` | Aggregate open pipeline totals and team roles for business context. |
| `inferRoleFromTitle` | Heuristic role abbreviation; it is inference, even though the old mapper promoted the result into a fact. |
| `discoverPartner` | Choose the most frequent co-participant in open opportunities; infer their role from title. Co-occurrence is not confirmed personal partnership. |
| `discoverRoleAndTeam` | Query manager, user role and active team; infer role abbreviation. |
| `discoverSalesforceContext` | Resolve org/schema/person Salesforce ID, run business probes concurrently, merge context. |
| `seedSalesforceContext` | Discover and save context. |
| `splitName`, `mapPartner`, `mapSalesforceToProfile` | Map manager, partner, territories and inferred role from business context into person fields. |
| `joinWithBudget`, `buildSalesforceHint`, `renderSalesforceContextMarkdown` | Bound prompt summaries and render richer business context. No independent person writes. |

Pinned plugin sources:
[AWS](https://github.com/f5-sales-demo/marketplace/blob/73064eb153fa50e48933f3060abe7e6622ad8e41/plugins/aws/src/index.ts),
[Azure](https://github.com/f5-sales-demo/marketplace/blob/73064eb153fa50e48933f3060abe7e6622ad8e41/plugins/azure/src/index.ts),
[GitHub](https://github.com/f5-sales-demo/marketplace/blob/73064eb153fa50e48933f3060abe7e6622ad8e41/plugins/github/src/index.ts),
[Salesforce registration](https://github.com/f5-sales-demo/marketplace/blob/73064eb153fa50e48933f3060abe7e6622ad8e41/plugins/salesforce/src/index.ts),
[business discovery](https://github.com/f5-sales-demo/marketplace/blob/73064eb153fa50e48933f3060abe7e6622ad8e41/plugins/salesforce/src/context/salesforce-context.ts),
[person mapper](https://github.com/f5-sales-demo/marketplace/blob/73064eb153fa50e48933f3060abe7e6622ad8e41/plugins/salesforce/src/context/profile-mapper.ts).

The preserved runtime launches with external extensions disabled. Its missing
AWS/Azure hints are therefore expected under that launcher configuration, independently
of whether the person service is registered. Their historical presence does not prove
that AWS/Azure were canonical person collectors. Integrating them into the canonical
contract would be new work, and should retain account-principal observations separately
from confirmed human facts.

## Separate computer profile

Historical [computer-profile.ts](https://github.com/f5-sales-demo/xcsh/blob/b0fae945221c094cfda26f884970aa146e8f5370/packages/coding-agent/src/internal-urls/computer-profile.ts)
used its own `computer-profile.json` and Schema.org `IndividualProduct` vocabulary.

| Function | Purpose |
| --- | --- |
| `getTerminalName` | Interpret terminal environment metadata. |
| `loadComputerProfile`, `saveComputerProfile` | Read/write the separate cache and stamp `collectedAt`. |
| `collectInstant` | Collect OS, kernel, architecture, CPU, memory, hostname, shell and terminal without subprocesses. |
| `collectDarwin`, `collectLinux`, `collectWindows` | Platform-specific model, physical cores and OS-version probes. |
| `collectDiskInfo` | Root filesystem capacity/free space on supported Unix platforms. |
| `collectInstalledTools` | CLI presence, including `az`, `aws`, `gh` and `sf`; no account enumeration. |
| `detectMdmVendor`, `collectManagement` | Management enrollment/vendor, organization and supervision metadata where available. Presence of a management binary was sometimes treated as managed status. |
| `collectSecurity` | Group-based admin heuristic plus macOS SIP, encryption, Gatekeeper and firewall status. These heuristics are not reliable authorization checks. |
| `collectEndpointAgents` | Activated macOS extensions or known endpoint-agent binary presence elsewhere. |
| `collectDeferred` | Run platform, disk, management, security, endpoint and tool probes concurrently. |
| `seedComputerProfile` | Merge existing cache with instant/deferred results and save. |
| `computerProfileIsStale` | Compare age with a 24-hour threshold. No production caller was found at the pinned revision; startup seeding was unconditional. |
| `buildComputerHint` | Compact runtime environment summary for prompts. |
| `renderComputerProfileMarkdown` | Full cached machine report for the internal resource. |

## Updated scope and qualification

The user subsequently confirmed that automatic person discovery **and** the separate
machine profile belong in this repair. The PII builder is a central self-awareness
requirement, not a fixed collection of account lookups. The source comparison above
describes the deficiencies of `54d586d78`; the follow-up implementation restores a
shared periodic builder, machine storage and retrieval, language initialization,
broader account evidence, Salesforce relationship discovery, extension compatibility,
and a model-facing structured observe operation. Collection is extensible, and
account or inferred relationship evidence remains distinct from confirmed human facts.

New regressions cover fresh-store initialization, source opt-out, account changes,
email suppression across account evidence, ordinary prompt preparation and resumed
Plan mode before TUI initialization finishes. Executing-agent qualification now adds
automatic population and machine retrieval to the existing empty-profile, learning,
correction and forgetting scenarios. Physical phone acceptance remains a separate gate.

1. Verify the now-authorized automatic person and machine discovery behavior. Keep
   plain resource reads side-effect free and block collection commits in Plan mode.
2. Test startup discovery from a missing store with synthetic available/unavailable
   accounts, restart freshness, source failures and four-session races. A seeded store
   bypasses the missing initialization path.
3. Exercise actual extension registration and profile-reader compatibility. Do not
   simply permit duplicate IDs to replace another source or restore unrestricted writes.
4. Preserve multiple account identifiers without allowing a source change to select a
   different local person. Label service principals, role sessions, locale-derived language
   and inferred business relationships according to the evidence actually available.
5. Test background cancellation, mode changes, source opt-out, corrections and forgetting.
   A refresh toggle must support disabling previously configured sources.
6. Reject person answers that append project-memory or prior-test recaps, even after a
   successful canonical get. The first native baseline is superseded by this stricter
   acceptance condition. The follow-up synthetic harness covers an empty profile,
   prior session history and an available memory read tool.

This source audit is not a live acceptance receipt. It does not claim that cloud
accounts were queried or that physical iPhone acceptance passed. Preserve existing
runtime sessions through qualification and verify the newly built artifact before
continuing physical acceptance.
