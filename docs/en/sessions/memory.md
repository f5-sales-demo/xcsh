---
title: Autonomous Memory
description: Autonomous memory system for persisting user preferences, project context, and feedback across sessions.
sidebar:
  order: 7
  label: Autonomous memory
---

# Autonomous memory

When enabled, the autonomous memory subsystem extracts durable technical knowledge from past sessions and injects a compact summary into each new session context. This maintains project-specific architectural decisions, recurring workflows, and resolution patterns without manual prompt construction.

Enable memory persistence in `config.yml` or via `/settings`:

```yaml
memories:
  enabled: true
```

## Memory context and URL schemes

### Startup context injection

At session initialization, xcsh loads the consolidated memory summary for the active project and injects a **Memory Guidance** block into the LLM system prompt. The agent adheres to the following behavioral rules:

- Treats memory as heuristic context — authoritative for historical rationale, secondary to live repository state.
- Cites the memory artifact path whenever memory informs a plan modification.
- Treats conflicting memory assertions as stale when contradicted by current source code.

### Reading memory artifacts (`memory://`)

Inspect memory artifacts directly using the `read` tool:

| URL scheme | Description |
| --- | --- |
| `memory://root` | Compact summary injected at session startup |
| `memory://root/MEMORY.md` | Full curated long-term project memory document |
| `memory://root/skills/<name>/SKILL.md` | Synthesized procedural skill playbook |

### `/memory` slash command

Manage memory state during interactive sessions:

| Subcommand | Description |
| --- | --- |
| `/memory view` | Displays the current memory injection payload. |
| `/memory clear` | Deletes stored memory records and generated artifacts. |
| `/memory rebuild` | Triggers immediate consolidation across past sessions. |

## Pipeline architecture

```text
Session histories ──► Phase 1: Extraction ──► Phase 2: Consolidation ──► MEMORY.md & skills/
```

- **Phase 1 (Extraction)**: Analyzes completed sessions within the age window (`minRolloutIdleHours` to `maxRolloutAgeDays`) using the `default` model role to extract discrete facts, architectural constraints, and resolved errors.
- **Phase 2 (Consolidation)**: Synthesizes per-session extractions using the `smol` model role to produce `MEMORY.md`, `memory_summary.md`, and reusable playbook directories (`skills/`).

## Configuration options

| Setting | Default | Description |
| --- | --- | --- |
| `memories.enabled` | `false` | Enables autonomous memory extraction and injection. |
| `memories.maxRolloutAgeDays` | `30` | Maximum age in days for historical sessions evaluated during extraction. |
| `memories.minRolloutIdleHours` | `12` | Minimum idle time in hours before an inactive session is processed. |
| `memories.maxRolloutsPerStartup` | `64` | Maximum session batch size processed during a single startup cycle. |
| `memories.summaryInjectionTokenLimit` | `5000` | Maximum token ceiling for startup system prompt memory injection. |

## Related implementation files

- `src/memories/index.ts`: Pipeline orchestrator, system prompt injection, and command handler.
- `src/memories/storage.ts`: SQLite storage backend for thread tracking and consolidation jobs.
- `src/internal-urls/memory-protocol.ts`: `memory://` protocol resolver for the `read` tool.
- `src/prompts/memories/`: Prompt templates for extraction, consolidation, and guidance.
