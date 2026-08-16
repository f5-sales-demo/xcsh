---
title: OpenAI access
description: Choose ChatGPT subscription or usage-based OpenAI Platform access in xcsh.
sidebar:
  order: 4
  label: OpenAI access
---

xcsh offers two separate OpenAI providers. Start xcsh without a configured provider, or run `/login`, and choose the option that matches how you want access to be billed.

## ChatGPT subscription

Choose **ChatGPT Plus/Pro (Codex Subscription)**, or run `/login openai-codex`. xcsh opens the ChatGPT OAuth flow and stores the resulting credential in its credential database. It then discovers the models advertised for that ChatGPT account.

When the account advertises the complete GPT-5.6 family, xcsh selects `openai-codex/gpt-5.6-terra` with medium reasoning and configures Luna, Terra, and Sol for its subscription routing roles.

The browser callback uses `http://localhost:1455/auth/callback`. Port 1455 must be available while login is running. If the browser cannot reach the callback directly, copy the complete redirect URL and submit it with `/login <redirect-url>` in the waiting xcsh session.

Credentials disabled by the OpenAI OAuth regression in v20.19.1 are reactivated automatically. Credentials disabled because they were deleted, invalid, expired, or failed for another reason remain disabled.

## Usage-based OpenAI Platform API

Choose **OpenAI Responses API (usage-based API access)** for OpenAI Platform billing. Set `OPENAI_API_KEY` in the environment, then select an OpenAI model with `/model`.

```sh
export OPENAI_API_KEY="your-platform-api-key"
xcsh
```

The ChatGPT subscription and OpenAI Platform API choices use different credentials and billing. `/login openai` therefore explains the API-key setup; it does not start ChatGPT OAuth.
