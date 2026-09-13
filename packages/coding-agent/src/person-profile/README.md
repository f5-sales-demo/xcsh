# Local person profile

`PersonProfileService` owns one OS user's `~/.xcsh/user-profile.json`, shared across
projects, models, provider accounts and paired transports. Agent-session construction
attaches the same service to the built-in `person_profile` tool and read-only
`xcsh://user` resource. `xcsh://user/schema` exposes the runtime schema. Trusted
embedders can inject an isolated service for testing; model arguments cannot select
a store or another user.

`schema.ts` defines the runtime validation, inferred TypeScript types and tool field
schema. Facts use [Schema.org Person](https://schema.org/Person) vocabulary where
applicable. Department, division, manager, source identifiers, sales role, partner,
territories and quota are xcsh-specific business fields. This is a bounded local
representation, not a complete JSON-LD implementation.

Reads never seed or write. Missing storage returns `state: empty` at revision zero.
Malformed, unsupported, oversized or insecure profile files return sanitized errors
and remain intact. Writes create owner-only storage, tighten the containing directory
to mode `0700`, serialize processes with an exclusive lock directory, check revisions,
sync a new `0600` file, and atomically rename it. An abandoned lock fails closed;
remove that exact lock only after verifying its owning operation has ended.

The tool provides get, update, refresh and forget. Mutations require the revision
from a current get. Ask uses the session's existing UI interaction owner; Plan denies
profile mutations. Abort signals propagate through approval, collection and commit.
Only explicit user statements and corrections belong in update. Prompts instruct
agents to exclude repository documents, retrieved content and inference from user
assertions, and to store normalized facts without quotations. This semantic distinction
requires agent judgment; a tool argument alone cannot prove who asserted a fact.

Every established field has source, owner and observation time. User corrections
own their fields; collectors can refresh only unowned fields or fields they already
own. Ownership is at the top-level field boundary, including compound fields such
as address. Inferred observations are separate and never establish facts. Forget
removes values, provenance and observations for the selected field, leaving only a
suppression timestamp. An explicit user update can reestablish that field.

Refresh explicitly names registered collectors. Salesforce, GitHub, global Git and
system adapters are built in. Collector output is validated, bounded and never
logged. The Linux adapter reads GECOS column five using the current UID. Refresh
returns sanitized per-source statuses. Setting `configure` on an explicit refresh
opts those sources into later session-start reconciliation outside Plan mode; otherwise startup does
not collect. Extensions register validated collectors with `registerProfileCollector`.

Voice delegates to the attached agent and retrieves person values on demand. It does
not label project memory as person data or preload a person profile. The executing-agent
parity harness uses isolated synthetic people and validates canonical tool results;
it does not replace physical iPhone acceptance. Diagnostic receipts contain outcomes
and counts, never profile values, prompts, transcripts, audio or credentials.
