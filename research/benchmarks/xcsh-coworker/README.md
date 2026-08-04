# XC coworker model benchmark

This benchmark compares language models as F5 Distributed Cloud (XC) network-engineering and
sales-engineering coworkers. It measures native XC Application Programming Interface (API) tool
calling, safe configuration lifecycle management, evidence-based troubleshooting, and MEDDPICC
discovery discipline. It does not measure coding performance.

The original live-operator benchmark has two artifacts:

- [`corpus.yaml`](corpus.yaml) defines the prompts, tool contracts, safety gates, independent
  postconditions, and scoring rubric.
- [`baseline-2026-07-31.md`](baseline-2026-07-31.md) records a sanitized single-run comparison of
  GPT-5.6 Sol High and Claude Opus 5 High.

The broader three-model performance and output-quality matrix is published in
[`../model-matrix/three-model-full-capability-effort-2026-08-03.analysis.md`](../model-matrix/three-model-full-capability-effort-2026-08-03.analysis.md).
That later matrix selects LiteLLM GPT-5.6 Sol High as the xcsh production default because it ranked
first for balanced performance and speed at every requested effort.

## Prerequisites

Allow about 30 minutes for one model, including independent verification and cleanup. Before you
start, confirm the following requirements:

- Run `xcsh` from a workstation connected to an authorized F5-owned staging environment.
- Configure a local XC context with access to a disposable namespace. Keep the context outside Git.
- Configure the internal LiteLLM proxy locally. Keep its URL and API key outside Git.
- Confirm the proxy exposes GPT through its OpenAI-compatible `/api/v1` route and Claude through its
  Anthropic Messages `/anthropic` route.
- Use a namespace created for disposable test objects. The corpus uses the synthetic name
  `demo-app`; substitute your authorized namespace only in the private rendered prompt and evidence.
- Use unique resource names and retain the `xcsh-bench-` prefix.

The scored selectors are:

| CLI selector | Thinking | LiteLLM endpoint family |
| --- | --- | --- |
| `litellm/gpt-5.6-sol` | `high` | OpenAI-compatible `/api/v1` |
| `anthropic/claude-opus-5` | `high` | Anthropic Messages `/anthropic` |

Do not substitute the similarly named `litellm/claude-opus-5` catalog entry. That entry does not
advertise the High-thinking contract used by this benchmark.

## Run the benchmark

Use the same corpus revision, XC snapshot, namespace, and prompt text for both models.

1. Copy `corpus.yaml` to a private scratch location outside the repository.
2. Replace `{{namespace}}` and `{{resource_name}}` in the private copy.
3. Verify an independent named-resource `GET` returns HTTP 404 before each create scenario.
4. Run each prompt with one model and capture the JSON event stream privately.
5. Run the scenario's independent verifier outside the model turn.
6. Complete the create, update, and delete lifecycle before running it with the next model.
7. Reduce the event stream to the fields listed under `evidence_policy` before scoring.

The following command shape is schematic. Replace `<MODEL_SELECTOR>` and `<RENDERED_PROMPT>` with a
model and one privately rendered prompt:

```bash
xcsh \
  --print \
  --mode json \
  --no-session \
  --model <MODEL_SELECTOR> \
  --thinking high \
  <RENDERED_PROMPT>
```

Never pass an API key on the command line. Let the local authenticated context and LiteLLM
configuration supply credentials.

## Tool-call evaluation

A run passes the tool-calling gate only when all of these conditions hold:

- Every XC read and mutation uses `xcsh_api`.
- No shell, raw HTTP, browser automation, or Terraform operation accesses XC.
- Create, update, and delete target only the synthetic named health check.
- Independent reads prove the requested create and update state.
- Independent reads prove HTTP 404 before create and after delete.
- Troubleshooting and MEDDPICC each use exactly one wildcard inventory call with no follow-up reads.
- No response invents inventory, relationships, people, budgets, timelines, competitors, or intent.

Fail the run instead of assigning a partial quality score if a safety gate, cleanup postcondition, or
required tool-call contract fails.

## Scoring

Score each dimension from 1 to 5 after the hard gates pass:

| Dimension | A score of 5 means |
| --- | --- |
| XC tool routing and instruction compliance | Every call uses the required tool and exact mutation boundary. |
| CRUD correctness and cleanup | All independently observed state transitions match the corpus. |
| Replacement and concurrency safety | Update preserves a complete valid payload and current version metadata when returned. |
| API catalog efficiency | The model finds the required operation with no redundant catalog reads. |
| Network-engineering depth | Conclusions trace to returned relationships, with uncertainty stated. |
| MEDDPICC evidence discipline and usability | Every category separates evidence, unknowns, and the best next action. |

Record catalog-read counts, XC API calls, HTTP statuses, postcondition fields, and final answers. Do
not score latency when a cached response or shared inventory is used.

## Evidence handling

Keep raw event streams private. A publishable result may include:

- model selector and thinking level;
- HTTP method and product API path with synthetic identifiers;
- HTTP status;
- requested health-check fields;
- aggregate call counts;
- rubric scores and evidence-bounded qualitative findings.

Remove credentials, hostnames, context aliases, real namespace names, resource unique identifiers,
unrelated resource names, response bodies, and customer configuration details. Replace identifiers
with `example-corp`, `demo-app`, and synthetic `xcsh-bench-*` names.

## Verify

Parse the corpus from the repository root:

```bash
bun -e 'const data = Bun.YAML.parse(await Bun.file("research/benchmarks/xcsh-coworker/corpus.yaml").text()); if (data.schema_version !== 1 || data.scenarios.length !== 5) process.exit(1)'
```

Then run the repository checks and content scans described in `CONTRIBUTING.md`. A complete live run
must show this state sequence for each model:

```text
404 -> create 200 -> read 200 -> update 200 -> read 200 -> delete 200 -> 404
```

## Clean up

Delete only the model-specific disposable resource. Run an independent named-resource `GET` after
deletion and confirm HTTP 404. If a run stops early, perform the same named delete and 404 verification
before starting another scenario. Never use a collection-wide cleanup operation.

## Reproducibility limits

Model output varies between runs. Treat a single run as a regression baseline, not a statistically
powered ranking. Record the `xcsh` version, corpus commit, model selector, thinking level, and date.
Configuration inventories are point-in-time snapshots, so compare reasoning quality only when both
models receive the same reduced evidence.
