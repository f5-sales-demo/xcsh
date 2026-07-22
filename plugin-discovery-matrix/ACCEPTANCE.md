# Phase-2 native acceptance — Installed Plugins capability index

Measured on the local dev build (`bun … src/cli.ts --mode json`, temp 0), meddpicc installed
via the marketplace. "control" condition = base config, no `--append-system-prompt`, so the
section renders **natively** from the core template. Metric = engine invocation in the
tool-call transcript. Baseline reference: pre-change control was **0% across all triggers**.

## Iteration 1 — per-plugin marketing description only

| Prompt | INVOKED | touched (incl. READ) | note |
|---|---|---|---|
| score | 3/3 | 3/3 | flagship computational task: 0% → 100% |
| next | 3/9 (33%) | 5/9 | engine-only ordering; 44% risky bypass |
| overview | 0/3 | 0/3 | agent explains from own knowledge (0 tool calls) |
| negative | 0/3 INVOKED | — | clean |

`next` (33%) missed the reliability bar.

## Root cause (no guessing)

`{{appendPrompt}}` renders at template line ~274, *above* the Installed-Plugins section at
~310 — so the winning experiment's technique A (delivered via `--append-system-prompt`) sat at
essentially the **same mid-prompt position** as the native section. Placement is therefore NOT
the differentiator. The real difference: A's per-plugin text carried an explicit engine nudge
("scored and sequenced by its engine, not by hand"), while the native section rendered only the
plugin's marketing `description`, which never mentions an engine. → **Wording is the lever.**

## Fix (generic, no plugin hardcoded)

Strengthened the section's intro to direct the agent to **run the plugin's engine/helpers to
produce any computed, scored, ranked, or "what to do next" result** rather than deriving it or
reading it from a data artifact (source-of-truth framing; embedded values may be stale/wrong).

## Iteration 2 — strengthened wording (shipped)

| Prompt | INVOKED | READ | BYPASS | n |
|---|---|---|---|---|
| next | 5 (83%) | 1 | **0** | 6 |
| score | 2 | 1 | **0** | 3 |
| overview | 1 | 2 | **0** | 3 |
| negative | 0 | 0 | **3** (clean) | 3 |

**Every trigger prompt now touches the plugin (0 bypass); the engine-only `next` task rose
33% → 83% invoked; the negative control stayed fully BYPASS (no over-triggering).** Root cause
confirmed by the fix lifting exactly the predicted metric.
