---
title: Anthropic access
description: Choose Claude subscription OAuth or usage-based Anthropic API access in xcsh.
sidebar:
  order: 4
  label: Anthropic access
---

xcsh supports two separate Anthropic credential paths. A Claude App Pro or Max subscription uses OAuth; an
Anthropic Console account uses usage-based API billing and an API key. Signing in to one does not grant access to
the other.

## Claude subscription

Run `/login anthropic` or select **Anthropic (Claude Pro/Max)** from the login picker. xcsh opens a loopback OAuth
route automatically and also displays a hosted authorization link that can be copied for SSH or headless use. The
hosted page returns `code#state`; paste that complete value into xcsh. Both routes use PKCE and require the exact
state generated for that login attempt.

After authentication, xcsh fetches the account's current model inventory. It applies the Claude subscription
profile only when fresh discovery advertises all three requested tiers:

| Role | Model and thinking | Purpose |
| --- | --- | --- |
| `smol` | Claude Haiku 4.5 at `low` | Lightweight work |
| `default` | Claude Sonnet 5 at `medium` | Everyday work |
| `slow` | Claude Opus 5 at `high` | Thorough work |
| `plan` | Claude Opus 5 at `high` | Planning |

Automatic routing follows Haiku → Sonnet → Opus. The highest-complexity escalation uses Opus at `xhigh`. xcsh
stores the exact selector advertised for each tier, including the dated Haiku 4.5 API ID when the canonical alias
is not advertised.

If any required tier is missing or the inventory is stale, the login remains valid but xcsh leaves the active
model, thinking level, roles, routing mode, and profile unchanged. Use `/model` to inspect and select the models
the account currently advertises.

## Anthropic API key

For usage-based Anthropic Console access, set `ANTHROPIC_API_KEY`. API requests are billed by Anthropic Console and
do not consume a Claude App subscription allowance. API-key authentication does not use `/login anthropic` and
does not automatically apply the Claude subscription profile.
