---
title: OpenAI access
description: Choose ChatGPT subscription or usage-based OpenAI Platform access in xcsh.
sidebar:
  order: 4
  label: OpenAI access
---

# OpenAI access methods

xcsh supports two distinct access methods for OpenAI services, depending on whether you authenticate with a ChatGPT subscription or an OpenAI Platform API key.

## 1. ChatGPT subscription (OAuth)

To use your ChatGPT Plus or Pro subscription, run `/login openai-codex` or select **ChatGPT Plus/Pro (Codex Subscription)** in the `/login` interactive picker. xcsh stores the OAuth credentials securely in `agent.db` and discovers advertised subscription models.

### Headless and SSH remote login

When running inside an SSH session or headless terminal, xcsh automatically initiates device-code authentication:

1. xcsh displays `https://auth.openai.com/codex/device` and a one-time verification code.
2. Open the URL in any web browser and log in with your ChatGPT account credentials.
3. Enter the one-time verification code.
4. The remote xcsh process detects authorization automatically and completes authentication.

> [!NOTE]
> Device-code authentication requires enabling the beta feature in ChatGPT under **Settings → Security**, or via workspace administrator settings under **Workspace settings → Permissions & roles**.

### Local desktop browser callback

On local workstations with graphical desktop environments, run `/login openai-codex-browser` (or select **ChatGPT Plus/Pro (Browser callback)**). This workflow opens your default browser and receives tokens through a local loopback listener on port 1455 (`http://localhost:1455/auth/callback`).

## 2. OpenAI Platform API (usage-based billing)

To use pay-as-you-go OpenAI Platform access, configure the `OPENAI_API_KEY` environment variable or provide it in `models.yml`:

```bash
export OPENAI_API_KEY="<OPENAI_API_KEY>"
xcsh
```

After starting xcsh, select an OpenAI model using `/model`.

