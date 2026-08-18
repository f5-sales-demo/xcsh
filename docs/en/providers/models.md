---
title: Model and Provider Configuration
description: Model registry and provider configuration via models.yml with routing, fallback, and pricing.
sidebar:
  order: 1
  label: Models & providers
---

This document describes how xcsh loads model registries, applies configuration overrides, resolves API credentials, and manages model selection at runtime.

## Core implementation architecture

Model configuration and runtime resolution are implemented across the following modules:

- `src/config/model-registry.ts`: Loads built-in and custom models, manages provider overrides, discovers local models, and integrates authentication.
- `src/config/model-resolver.ts`: Parses model patterns, handles canonical coalescing, and selects default, small, and reasoning models.
- `src/config/settings-schema.ts`: Defines settings schemas for `modelRoles` and transport options.
- `src/session/auth-storage.ts`: Resolves API keys and OAuth tokens across configuration sources.
- `packages/ai/src/models.ts` and `packages/ai/src/types.ts`: Defines built-in models and compatibility contracts.

## Configuration file path

Default configuration path:

- `~/.xcsh/agent/models.yml`

> [!NOTE]
> If `models.yml` is missing and a legacy `models.json` file exists in the configuration directory, xcsh automatically migrates the settings to `models.yml`.

## Schema structure

```yaml
configVersion: 1
providers:
  <PROVIDER_ID>:
    baseUrl: https://api.example.com/v1
    apiKey: MY_API_KEY_ENV_VAR
    api: openai-completions
    headers:
      X-Custom-Header: value
    auth: apiKey
    discovery:
      type: ollama
    modelOverrides:
      <MODEL_ID>:
        name: Custom Model Display Name
    models:
      - id: custom-model-id
        name: Custom Model Name
        api: openai-completions
        contextWindow: 128000
        maxTokens: 16384
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
equivalence:
  overrides:
    <PROVIDER_ID>/<MODEL_ID>: <CANONICAL_MODEL_ID>
  exclude:
    - <PROVIDER_ID>/<MODEL_ID>
```

### Supported API protocol types

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

## Validation rules

### Custom provider definitions (`models` defined)

The following fields are required:

- `baseUrl`: Base endpoint URL.
- `apiKey`: Required unless `auth: none` is explicitly configured.
- `api`: Protocol type specified at the provider or model level.

### Override-only providers (`models` omitted)

Must specify at least one of:

- `baseUrl`
- `modelOverrides`
- `discovery`

## Merge and override hierarchy

When initializing or refreshing the model registry, xcsh applies configuration in the following order:

1. **Built-in catalog**: Loads default providers and models from `@f5-sales-demo/pi-ai`.
2. **Custom configuration**: Parses `~/.xcsh/agent/models.yml`.
3. **Provider overrides**: Applies custom `baseUrl` and default `headers` to built-in models.
4. **Model overrides**: Merges custom settings from `modelOverrides`.
5. **Custom models**: Appends or replaces model definitions matching existing `provider/id` pairs.
6. **Runtime discovery**: Queries active local endpoints (such as Ollama or LM Studio) and registers discovered models.

## Canonical model equivalence and coalescing

xcsh groups equivalent model checkpoints from different providers under canonical upstream identifiers (for example, `claude-sonnet-4`, `gpt-5.3-codex`):

- **Overrides**: Maps specific provider identifiers to standard canonical names via `equivalence.overrides`.
- **Exclusions**: Removes specific variants from automatic grouping via `equivalence.exclude`.
- **Resolution priority**: Selects concrete providers based on credential availability and `modelProviderOrder` precedence.

## Runtime model discovery

xcsh detects local inference runtimes automatically:

- **Ollama**: Probes `http://127.0.0.1:11434/api/tags` (or `OLLAMA_BASE_URL`).
- **LM Studio**: Probes `http://127.0.0.1:1234/v1/models` (or `LM_STUDIO_BASE_URL`).
- **llama.cpp**: Probes `http://127.0.0.1:8080/v1/models` (or `LLAMA_CPP_BASE_URL`).

## Credential resolution hierarchy

When resolving API keys for a provider, xcsh evaluates sources in the following priority order:

1. CLI flag `--api-key`
2. Stored API keys in `agent.db`
3. Stored OAuth tokens in `agent.db`
4. Standard environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`)
5. Provider `apiKey` field in `models.yml` (evaluated first as an environment variable name, then as a literal token)

## Model roles and selection

xcsh supports logical role aliases configured via `settings.modelRoles`:

- `default`: Primary interaction model.
- `smol`: Fast, lightweight model for metadata tasks and short tool evaluations.
- `slow`: High-reasoning model for complex multi-step planning and analysis.
- `plan`: Model assigned to interactive planning modes.
- `commit`: Model assigned to git commit generation.

Each role definition can include thinking intensity suffixes (for example, `pi/smol:minimal`, `claude-sonnet-4:high`).

## Context promotion and fallback

When a model context window overflows during a conversation turn (`context_length_exceeded`), xcsh automatically promotes the session to a larger-context sibling model before initiating context compaction:

1. Evaluates explicit `contextPromotionTarget` configurations.
2. Identifies the smallest available model with a larger context window on the same provider.
3. Switches the session model temporarily and retries the turn.
