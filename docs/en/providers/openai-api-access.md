---
title: OpenAI access
description: Configure OpenAI Platform API access in xcsh.
sidebar:
  order: 4
  label: OpenAI access
---

xcsh supports OpenAI through usage-based Platform API access. Set `OPENAI_API_KEY` in the environment, then select an OpenAI model with `/model`.

```sh
export OPENAI_API_KEY="your-platform-api-key"
xcsh
```

ChatGPT subscription access is not available in xcsh. Use the official Codex CLI and run `codex login` when you need ChatGPT subscription entitlement.

Existing `openai-codex` OAuth credentials are disabled without being deleted. Remove them explicitly with `/logout openai-codex` if they are no longer needed.
