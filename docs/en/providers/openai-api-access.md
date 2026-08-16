---
title: OpenAI access
description: Choose ChatGPT subscription or usage-based OpenAI Platform access in xcsh.
sidebar:
  order: 4
  label: OpenAI access
---

xcsh offers two separate OpenAI providers. Start xcsh without a configured provider, or run `/login`, and choose the option that matches how you want access to be billed.

## ChatGPT subscription

Choose **ChatGPT Plus/Pro (Codex Subscription)**, or run `/login openai-codex`. xcsh stores the resulting credential in its credential database and discovers the models advertised for that ChatGPT account.

### SSH and headless login

In an SSH or headless terminal, `/login openai-codex` uses device-code authentication automatically:

1. xcsh prints `https://auth.openai.com/codex/device` and a short one-time code.
2. Open that page in any ordinary browser, including a managed workstation browser, and sign in.
3. Enter the one-time code. The xcsh process on the remote host detects approval and completes login.

The browser workstation does not need xcsh or Codex installed. This flow does not open port 1455, use an SSH tunnel, or require copying a redirect URL. Continue only when you initiated the displayed code from your own xcsh session.

Device-code login is an OpenAI beta feature. It must be enabled under ChatGPT **Settings → Security**, or by a workspace administrator under **Workspace settings → Permissions & roles**. If it is disabled, xcsh explains the setting and leaves the browser callback method available. See [OpenAI's headless authentication guidance](https://learn.chatgpt.com/docs/auth#preferred-device-code-authentication-beta).

### Local browser callback

On a local graphical desktop, `/login openai-codex` keeps using browser PKCE. To choose that method explicitly, select **ChatGPT Plus/Pro (Browser callback)** or run `/login openai-codex-browser`.

When the account advertises the complete GPT-5.6 family, xcsh selects `openai-codex/gpt-5.6-terra` with medium reasoning and configures Luna, Terra, and Sol for its subscription routing roles.

The browser callback uses `http://localhost:1455/auth/callback`. Port 1455 must be available while login is running. The manual `/login <redirect-url>` fallback remains available, but device-code login is the intended method when the browser and xcsh run on different hosts.

Credentials disabled by the OpenAI OAuth regression in v20.19.1 are reactivated automatically. Credentials disabled because they were deleted, invalid, expired, or failed for another reason remain disabled.

## Usage-based OpenAI Platform API

Choose **OpenAI Responses API (usage-based API access)** for OpenAI Platform billing. Set `OPENAI_API_KEY` in the environment, then select an OpenAI model with `/model`.

```sh
export OPENAI_API_KEY="your-platform-api-key"
xcsh
```

The ChatGPT subscription and OpenAI Platform API choices use different credentials and billing. `/login openai` therefore explains the API-key setup; it does not start ChatGPT OAuth.
