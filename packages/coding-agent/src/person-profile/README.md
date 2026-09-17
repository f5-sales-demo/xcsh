# Private person and computer profiles

`PersonProfileService` and `MachineProfileService` own one OS user's private
runtime profiles. They are shared across projects, models, accounts and transports;
callers cannot select another user's store. `xcsh://user` and
`xcsh://computer` are side-effect-free resources with `/schema` routes, while
`xcsh://about` remains xcsh build identity.

## Storage and recovery

The only supported persisted format is the versioned typed envelope defined by
`schema.ts` and `machine-profile.ts`. Unversioned, malformed, unsupported,
oversized or insecure files fail closed with domain-specific, value-free error
codes. xcsh never migrates, salvages, quarantines, backs up or silently deletes
an invalid profile.

`xcsh profile status [--json]` reports only missing, ready or invalid state,
schema version, permissions and a sanitized reason. `xcsh profile reset
person|computer|all` is the human recovery boundary: it locks and revalidates
exact owned regular-file targets, refuses symlinks and ownership mismatches, and
deletes no unrelated path. Interactive use requires confirmation;
non-interactive use requires `--yes`. Missing targets succeed idempotently. The
next normal startup reconstructs selected profiles through discovery.

Writes create a `0700` directory and atomic `0600` file, reject non-owned paths,
use no-follow reads, bound document size, serialize processes through locks,
check revisions and fsync before rename. Person and computer failures are
independent.

## Ownership, learning and discovery

Facts use Schema.org Person vocabulary where applicable. Every established field
has owner, source and observation time. Explicit user statements and corrections
use `update`; collected or inferred information uses `observe`. User corrections
retain ownership. `additionalProperty` entries have independent provenance and
suppression. Forget removes selected values and evidence while retaining only a
value-free suppression timestamp, preventing automatic rediscovery until an
explicit user update.

CLI sessions attach to one process-wide coordinator keyed by person and computer
paths. Startup, before-input and periodic requests join one in-flight refresh.
Independent collectors run with bounded concurrency, source failures remain
isolated, and five-minute person plus daily computer freshness avoid needless
work. Plan mode and cancellation prevent commits. Salesforce, GitHub, GitHub
email, Git, system, Azure, AWS, Google Cloud, GitLab, machine and extension
collectors remain supported. Per-source diagnostics contain status,
attempt/success time and duration, never values or raw output.

Extensions use one required API: `personProfile.get()`,
`personProfile.registerCollector()` and `personProfile.unregisterCollector()`.
There is no flat loader, direct JSON fallback or top-level compatibility
registration. Collector IDs and unregister ownership remain scoped to the
registering extension.

## PII durability contract

Personal values are permitted only in these private local runtime stores. Real
PII is forbidden in source, fixtures, logs, telemetry, traces, prompts, issues and
generated evidence; tests use synthetic identities and evidence records only
counts, hashes, statuses and pass/fail outcomes. Profile routes, startup
registration, collector APIs and schemas are intentional product functionality,
not generic cleanup targets. Removing one requires updating the focused contract
tests and person-awareness owner review. Provenance, selective forgetting, source
opt-out, inspection and exact-target reset are part of the access and deletion
boundary.
