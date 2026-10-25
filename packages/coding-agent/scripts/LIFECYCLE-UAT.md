# Local lifecycle campaign

Run `bun run lifecycle-uat -- <operation> --campaign-dir <private-directory>` from
the coding-agent package. A campaign freezes a full source commit, executable
SHA-256, reference commit/package/schema hashes, phone build, discovered controls,
case definitions and two ordered core repetitions. Never reuse a campaign after
the candidate, phone build, reference or acceptance catalog changes.

The controller offers `prepare`, `preflight`, `start-case`, `finish-case`,
`import-human`, `import-gate`, `import-receipt`, `analyze`, `replay`, `status`,
`resume`, `invalidate`, `replace` and `finalize`. Each option requires a value.
`prepare` reads `--manifest`; `start-case` reads `--case`, `--identities` and
optional `--cycle 0|1|2`. Cycle zero records individual cases; cycles one and two
are ordered core acceptance runs. `import-human` reads `--file` and optional
`--attempt`. Outcomes cannot be replaced after import. An invalid observation
requires a new attempt and an appended finding.

`import-gate --gate unit|installed --outcome pass|fail --file <path>` preserves
the source bytes privately and binds their digest. Unit JSON must contain
campaignId, attemptId, caseId, candidateCommit, binarySha256, command, exitCode
and outputSha256. Installed evidence uses the existing sanitizing collector's
JSONL manifest/events/footer format. Missing footers, sequence gaps, wrong
source provenance or absent ordered transition methods fail its gate.

`import-receipt --receipt <record> --file <evidence>` binds a versioned
LifecycleReceipt to the attempt and exact artifact hash. The evidence must
contain matching campaignId, attemptId, caseId, name and outcome. Existing voice
preflight/resource, replay-before-close and 60-second post-close collectors
remain authoritative; their receipts must be imported explicitly.

`replay --reference <jsonl> --candidate <jsonl>` uses the existing strict
structural comparator. Redacted semantic content requires further review and
cannot become a reference pass merely through matching shapes. Physical UI,
audio, navigation and transcript observations remain independent requirements.

The Linux CLI adapter owns only `xcsh-uat.service`. It reads supervisor/child
executable paths, hashes, invocation, restart count, service configuration and
unexpected xcsh processes. `--configuration` identifies the configuration bytes
to hash. Development builds stay outside installed artifact directories.
Replacement uses the existing graceful systemd replacement helper. Finalization
recomputes case gates from the hash-linked event log and artifact bytes and
requires five recorded replacements, all required individual cases and both
core runs. It refuses incomplete campaigns.

The controller records evidence and governs progression. It does not invent a
phone control inventory, first-party QR payload, human observations, reference
qualification, or fault injection. Populate precise fixtures and prerequisites
from the actual iPhone/reference observations before freezing the catalog.
Keep tokens, QR/manual codes, SDP, private text, audio and correlation salts out
of committed evidence. The local campaign files require private storage.
