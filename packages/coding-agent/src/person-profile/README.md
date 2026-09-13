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

The tool provides get, sources, update, observe, refresh and forget. Mutations require the revision
from a current get. Ask uses the session's existing UI interaction owner; Plan denies
profile mutations. Abort signals propagate through approval, collection and commit.
Only explicit user statements and corrections belong in update. Prompts instruct
agents to exclude repository documents, retrieved content and inference from user
assertions, and to store normalized facts without quotations. This semantic distinction
requires agent judgment; a tool argument alone cannot prove who asserted a fact.

Every established field has source, owner and observation time. User corrections
own their fields; collectors can refresh only unowned fields or fields they already
own. Ownership is at the top-level field boundary, including compound fields such
as address. The xcsh additionalProperty extension uses Schema.org PropertyValue-shaped
entries for attributes without a standard Person field. Each stable propertyID has its
own ownership, provenance and value-free forgetting suppression; updating one entry
preserves the others. Tool forget accepts propertyIds for selective removal. Observed account evidence and inferred observations never establish facts. Forget
removes values, provenance and observations for the selected field, leaving only a
suppression timestamp. Forgetting email also removes email-bearing account evidence;
future evidence passes through the same suppression filter. An explicit user update
can reestablish that field. A changed collector identity produces observations instead
of silently replacing the human's established identity.

CLI sessions automatically start the PII builder, including launches with extensions
disabled. Trusted process configuration `XCSH_PROFILE_DISCOVERY=0` disables automatic
discovery for isolated CLI tests or embedding; tool reads and explicit refresh remain
available. SDK embedders enable the same lifecycle with `profileDiscovery: true` and
can inject isolated person and machine services. Background discovery checks once a
minute, with five-minute person-source freshness and daily machine freshness. The
first normal input and queued input join pending preparation. Disposal cancels the
builder, and both restored and newly entered Plan mode prevent commits.

Salesforce, GitHub, associated GitHub email addresses, global Git, system, Azure,
AWS, Google Cloud and GitLab adapters provide initial sources. Extensions add validated
collectors; source discovery is programmatic and does not hardcode these names into
the tool schema. Observe also records structured evidence learned during interaction
from other identified sources, preserving observed versus inferred status. Neither
credentials nor source quotations belong in the profile. Directory and account
principals remain evidence until associated with the human; service accounts and role
sessions never establish human identity by themselves.

Collector output is validated and bounded; raw output and errors are not logged.
The Linux adapter reads GECOS column five by UID. OS locale supplies UI preference
and an inferred language observation. Per-source attempt/success timestamps and
sanitized status persist even when a source is unavailable. Refresh selects named
collectors or all registered collectors when sources are omitted. Configure selects
future background sources; an empty configured list disables person collection.

`MachineProfileService` maintains a separate private `computer-profile.json`, using
Schema.org IndividualProduct identity with explicitly described xcsh environment
fields. Historical hardware, OS, CPU, memory, disk, terminal, tool, management and
security probes are restored with bounded subprocesses. These are environment
observations, not authorization decisions. `interactionDevices` links the human to
the device used for interaction without claiming ownership. `machine_profile` and
read-only `xcsh://computer` share this service; `xcsh://computer/schema` exposes its
runtime schema. Person and machine files share secure persistence mechanics.

The read-only `loadProfile` compatibility export returns flat facts to legacy
marketplace collectors. Built-in IDs are retained when a richer plugin registers
the same ID; the plugin receives an `_extension` collector ID, with its own ownership.
Another extension cannot take over that registration. Unregister is scoped to the
registrant. Reconciliation saves bootstrap results before dependent collectors run.

Voice delegates to the attached agent and retrieves person values on demand. It does
not label project memory as person data or preload a person profile. The executing-agent
parity harness uses isolated synthetic people and validates canonical tool results;
it does not replace physical iPhone acceptance. Diagnostic receipts contain outcomes
and counts, never profile values, prompts, transcripts, audio or credentials.
