---
title: Herdr terminals
description: Run xcsh conversations with isolated, conversation-owned support terminals.
---

# Herdr terminals

xcsh can bind one conversation to one Herdr workspace and expose named support terminals as tabs. The recommended full rich-media stack is Ghostty with Kitty graphics, Herdr with `experimental.kitty_graphics=true`, and FFmpeg 6 or newer. Other terminals remain usable and receive static media fallbacks.

Launch a conversation-owned workspace from outside Herdr:

```bash
xcsh herdr --session my-organization --label project-task -- --model openai/gpt-5
```

The launcher creates the workspace, writes a mode-`0600` `HerdrBindingV1` under the user state directory, starts xcsh in the root pane, and attaches to the named Herdr session. Plain `xcsh` remains fully supported; terminal-management operations report unavailable without both a launcher-issued owner binding and `HERDR_SOCKET_PATH`.

Inside the conversation, humans use `/terminal` and the model uses `herdr_terminal`. Both surfaces provide `list`, `create`, `run`, `send`, `read`, `wait`, `status`, `focus`, and `close` actions. Creation is always non-focusing. Focus is an explicit action. A busy terminal rejects the first close and requires a second close with `force: true` (or `/terminal close NAME --force`).

Ownership is enforced by a random `xcsh_owner` metadata token on the workspace and each managed pane. xcsh lists, reads, sends to, focuses, and closes only panes carrying the current binding token. Tabs from other conversations or users are not exposed. Session creation, resume, switching, branching, and tree navigation keep the workspace and tabs while refreshing the stored xcsh session reference.

The socket client uses Herdr protocol 18 over newline-delimited JSON on `HERDR_SOCKET_PATH`. Each request reconnects independently, validates the `ping` protocol version, caps responses at 4 MiB, and uses bounded timeouts so a Herdr restart cannot wedge the chat process.
