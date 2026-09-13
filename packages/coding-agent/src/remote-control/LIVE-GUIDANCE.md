# GPT-Live guidance review

Reviewed against the official documentation on 2026-09-13. This review covers
architecture and conversational behavior; it does not certify phone acceptance.

## Architecture and transport

The [Live overview](https://developers.openai.com/api/docs/guides/live) supports
client delegation when an application owns an existing backend. xcsh attaches the
voice surface to its existing `AgentSession`; that session owns the tool registry,
context selection, permissions, and task history. Voice does not create another
credential or tenant-selection authority.

The public API examples use project API credentials. The paired phone path here
uses the separately pinned Codex subscription OAuth protocol and
`gpt-live-1-codex`. Public `/v1/live/sessions` examples are not proof of subscription
access or a reason to replace that transport. Protocol changes need separate
source-contract and integration qualification.

## Prompt boundary

[Live prompting](https://developers.openai.com/api/docs/guides/live-prompting)
recommends a compact speaking/delegation policy and backend-owned procedures.
The v3 persona now uses `remote-voice-live.md`, with registered tool names and bounded
speaking preferences and recent context. It omits the terminal system prompt and
full tool descriptions. The complete envelope stays within 8 KiB. This is a local
engineering budget, not an OpenAI token-limit claim. Legacy fixtures retain their
existing contract.

The listening policy intentionally disables backchannels to honor the user's
preference. Prompt tests check this boundary; actual pauses and interruptions still
require listening to phone conversations.

## Execution, interruptions, and results

[Delegation guidance](https://developers.openai.com/api/docs/guides/live-delegation)
keeps application authorization and task state authoritative. In xcsh, delegation
IDs are preserved, repeated submissions are suppressed, and active-session
corrections use the existing steering path. Closing voice leaves backend work
running. An interrupted backend turn now reports interruption without implying
that completed actions were undone.

Context activation checks approval, cancellation, configuration revision, and
connection status before dependent queries. API target checks reject requests
against a different selected context. Structured response phase metadata routes
progress and final output; private reasoning is excluded. Native result chunks
remain bounded by the pinned transport contract.

When the backend explicitly requires `xcsh_context`, it treats that named choice as
an execution boundary. The response stays private until the matching call is
complete. A pre-invocation output-limit stop receives one retry with the same named
choice; cancellation is not retried, and substituted tools are never dispatched.
This preserves backend ownership without asking the voice model to select credentials.

At-most-once submission is not exactly-once execution: crash-gap reconciliation
remains an acceptance limitation. Do not retry an uncertain mutation merely
because its spoken result was lost.

## Evaluation and remaining gates

The [voice evaluation guide](https://developers.openai.com/cookbook/examples/audio/voice_agent_evaluation)
separates spoken experience from backend task results. `CONTEXT-WORKFLOW.md` describes
our synthetic execution checks and manual response review. A passing text-agent
trace does not establish microphone recognition, natural timing, or whether the
user heard a useful answer. Physical evaluation must include combined requests,
follow-ups, corrections, pauses, cancellation, and access failures.

The broader executing-agent run exposed false claims that a registered context
tool was unavailable. Provider-request observations confirmed its schema was
present, and a bounded SSE comparison ruled out transport as the cause. The backend
now guards the exact named-tool request as described above. Deterministic length,
repeat-failure, cancellation, and substituted-tool cases plus bounded live TUI and
delegated-voice checks cover the repair. A clean full evaluator run and physical
phone interaction remain separate release gates.
