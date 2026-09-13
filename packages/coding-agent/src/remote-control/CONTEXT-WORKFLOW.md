# Context selection and resource conversations

The objective is a reliable conversation, rather than a hard-coded answer to one
inventory question. A user can select a tenant and ask a resource question in one
utterance or across several turns. Native conversational input and delegated voice
execute through the same attached agent session.

## Execution contract

1. Resolve the current request's target. An explicit saved-context name takes
   precedence over a name in earlier conversation. List saved names when necessary.
   Missing or ambiguous names require a concise clarification; do not substitute a
   remembered context.
2. Select through `xcsh_context` using the same `ContextService.activate` operation
   as `/context <name>`. The terminal slash command remains available. Selection
   changes the process's context environment overlay, not the saved credential file.
3. Wait for selection and connectivity validation. Ask approvals belong to the
   attached session. Declines, cancellation, changed configuration during review,
   and Plan mode prevent a pending selection from committing. Late authentication
   results cannot overwrite a newer context's status.
4. Bind subsequent `xcsh_api` calls with `contextName`. The tool rejects a mismatched
   context before executing the request. Explicit `XCSH_*` environment overrides
   retain their existing precedence; the context result reports effective state.
5. Resolve resource type, namespace coverage, and any identity filter from current
   evidence. An explicitly supplied creator ID is usable in its stated tenant.
   A credential principal, person-profile email, or accessible inventory alone does
   not establish the human's creator ID. Request only missing information.
6. Retrieve the evidence needed for the question. For a scoped single-type query,
   use `expandDiscovery: false` to retain the endpoint's full response without
   automatically retrieving other resource types. Broad inventory continues to use
   explicit namespace discovery. Read creator metadata, follow documented pagination,
   and distinguish missing attribution from a nonmatching creator. Batched detail
   responses retain their metadata; failed and partial batches retain per-request
   status and are not cached as successful empty inventories.
7. Respond with the result and relevant scope, briefly confirming a requested
   context change. Explain material access or coverage gaps. Stop when the evidence
   answers the question instead of repeating detail reads or narrating every tool.

The voice component passes the combined intent to its attached session and relays
the result. It does not independently select credentials, maintain a second tenant
state, or announce success before delegation completes. The existing delegation,
cancellation, session history, and approval ownership mechanisms remain in use.

## Observe, analyze, improve, repeat

`scripts/voice-context-evaluation.ts` runs an executing model against synthetic
tenant transport while using the real session, context service, tool registry,
API tool, and voice delegation envelope. Scenarios cover combined and separate
turns, missing contexts, authentication failure, and identity supplied in the conversation, held in the person profile, or unresolved.
Additional variations cover creator metadata available only in detail responses
and denied inventory requests. A separate
source checkout can provide the baseline:

```sh
XCSH_CONTEXT_EVAL_SOURCE=/path/to/baseline-checkout \
XCSH_CONTEXT_EVAL_OUTPUT=/private/evidence/baseline \
bun packages/coding-agent/scripts/voice-context-evaluation.ts --baseline

XCSH_CONTEXT_EVAL_OUTPUT=/private/evidence/candidate \
bun packages/coding-agent/scripts/voice-context-evaluation.ts
```

Optional `--scenario=<id>` and `--surface=tui|voice-delegated-agent` select a bounded
rerun. `XCSH_CONTEXT_EVAL_MODEL` selects a model from the existing subscription OAuth
catalog. The harness never contacts a real tenant, changes a real context file, or
reads real personal profiles. It uses a distinct synthetic credential per fixture to
isolate the API cache, permits only catalog and isolated synthetic profile reads, and stores evidence outside the
repository with private permissions.

Evaluate four dimensions separately:

| Dimension | Evidence | Failure examples |
| --- | --- | --- |
| Intent and state | Requested target, completed selection, later requests | Substituted context; old tenant queried; follow-up loses selection |
| Execution | Ordered tool/transport events and connection outcomes | Query before selection completes; request after authentication failure |
| Efficiency | Assistant turns, tool calls, tenant requests, repeated reads | Namespace-wide discovery for a scoped question; redundant detail retrieval |
| Response quality | Review the synthetic answer against returned evidence | Invented attribution; unnecessary clarification; unqualified complete-inventory claim |

`scoreContextFlow` evaluates causal execution, independently of response wording.
The harness also reports response length and simple answer checks. Those checks
are screening signals; they do not prove semantic correctness or natural speech.
Review the synthetic turns and answer before accepting a run. Record the model,
source revision, fixture version, failures, repair, and the subsequent rerun.
The result receipt includes revision and tracked-change state; failing scenarios
produce a nonzero exit. Provider-request traces record tool counts and whether the
context schema was present, without storing the provider payload. This distinguishes
a missing capability from an agent incorrectly claiming that an available tool is
missing. Review all cases together; retain failed runs instead of selecting only
successful samples.

Fixture paths use opaque names so directory names cannot reveal expected outcomes.
Read restrictions describe only the unavailable read path, without implying that
other tools are prohibited. These controls prevent evaluation setup from supplying
unintended hints or artificial blockers.

Initial observations motivating this implementation were a plausible answer from
the previous tenant, substitution of a remembered context after a missing-name
request, and automatic broad discovery that discarded creator metadata and led to
repeated detail reads. Keep those failure modes as regression cases rather than
tuning only for a successful example.

## Physical interaction evaluation

Executing-agent delegation tests do not exercise microphone recognition, realtime
speech, phone approval presentation, or interruptions. Evaluate those separately
on the attached phone session with ordinary phrasing, pauses, a combined request,
a follow-up, a corrected context name, and a cancelled selection. Observe whether
the assistant preserves intent, asks only useful questions, waits for execution,
and speaks a concise evidence-grounded response.

Keep real prompts, transcripts, audio, profile values, tenant data, and credentials
out of committed evidence. Record live tool names, outcome categories, counts, and
booleans. Only generated synthetic fixtures and their algorithms belong in source.
