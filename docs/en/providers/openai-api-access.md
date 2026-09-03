---
title: OpenAI access
description: Choose ChatGPT subscription or usage-based OpenAI Platform access in xcsh.
sidebar:
  order: 4
  label: OpenAI access
---

xcsh supports two distinct access methods for OpenAI services, depending on whether you authenticate with a ChatGPT subscription or an OpenAI Platform API key.

## 1. ChatGPT subscription (OAuth)

To use your ChatGPT Plus or Pro subscription, run `/login openai-codex` or select **ChatGPT Plus/Pro (Codex Subscription)** in the `/login` interactive picker. xcsh stores the OAuth credentials securely in `agent.db` and discovers advertised subscription models.

When fresh authenticated discovery advertises all three GPT-5.6 tiers, login applies this role profile atomically:

| Role | Model and effort | Intended use |
| --- | --- | --- |
| `smol` | `openai-codex/gpt-5.6-luna:low` | Lightweight and metadata work |
| `default` | `openai-codex/gpt-5.6-terra:medium` | Balanced everyday work |
| `slow` | `openai-codex/gpt-5.6-sol:high` | Thorough analysis |
| `plan` | `openai-codex/gpt-5.6-sol:high` | Architectural planning |

The active post-login model is Terra at medium effort. This follows
[OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model):
Luna is the efficient high-volume tier, Terra balances intelligence and cost, and Sol is the
flagship for complex professional work. OpenAI recommends medium as a balanced starting point,
low for latency-sensitive work, and higher efforts only where they produce a measured quality gain.

Automatic routing remains off after login. If you enable it, the existing pool routes Luna/low → Terra/medium → Sol/high and uses Sol/xhigh only for rejected work or the highest-complexity requests. `max` remains available as a manual quality-first effort rather than a static role default.

If Luna, Terra, or Sol is absent—or authenticated discovery is stale—the profile and active model are left unchanged.

### Headless and SSH remote login

When running inside an SSH session or headless terminal, xcsh automatically initiates device-code authentication:

1. xcsh displays `https://auth.openai.com/codex/device` and a one-time verification code.
2. Open the URL in any web browser and log in with your ChatGPT account credentials.
3. Enter the one-time verification code.
4. The remote xcsh process detects authorization automatically and completes authentication.

> [!NOTE]
> Device-code authentication requires enabling the beta feature in ChatGPT under **Settings → Security**, or via workspace administrator settings under **Workspace settings → Permissions & roles**.

### Local desktop browser callback

On local workstations with graphical desktop environments, the same `/login openai-codex` command opens your default browser and receives tokens through a local loopback listener on port 1455 (`http://localhost:1455/auth/callback`).

If device authorization is unavailable in an SSH or headless session, the same login flow offers browser/manual redirect authentication. Open the displayed URL locally, then paste the redirect URL into `/login <redirect URL>` on the remote host.

## 2. OpenAI Platform API (usage-based billing)

To use pay-as-you-go OpenAI Platform access, configure the `OPENAI_API_KEY` environment variable or provide it in `models.yml`:

```bash
export OPENAI_API_KEY="<OPENAI_API_KEY>"
xcsh
```

After starting xcsh, select an OpenAI model using `/model`.
