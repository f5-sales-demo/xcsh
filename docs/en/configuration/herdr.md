---
title: Herdr terminals
description: Run xcsh conversations with isolated, conversation-owned support terminals.
---

# Herdr terminals

The `xcsh` runtime binds individual conversations to dedicated Herdr workspaces and exposes named support terminals as tabs. The recommended rich-media stack consists of Ghostty with Kitty graphics support, Herdr configured with `experimental.kitty_graphics=true`, and FFmpeg 6 or later. Other terminal emulators receive static text fallbacks automatically.

## Media and graphics protocol negotiation

When a released Herdr version exposes `HERDR_KITTY_GRAPHICS=1` alongside `HERDR_ENV=1`, `xcsh` enables the Kitty image protocol for TTY output even though Herdr reports `TERM=xterm-256color`. Both environment markers must be set to `1`; if either marker is missing or contains any other value, image rendering remains disabled for that generic terminal type.

The `PI_FORCE_IMAGE_PROTOCOL` variable overrides automatic detection. If you modify your Herdr configuration, restart your terminal applications so child processes inherit the updated environment variables.

## Launching conversation-owned workspaces

Launch a conversation-owned workspace from outside Herdr:

```bash
xcsh herdr --session my-organization --label project-task -- --model openai/gpt-5
```

The launcher executes the following sequence:

1. Creates the Herdr workspace.
2. Writes a mode-`0600` `HerdrBindingV1` file under the user state directory.
3. Starts `xcsh` in the root pane.
4. Attaches to the named Herdr session.

Standard `xcsh` invocations remain supported; terminal management operations report as unavailable unless both a launcher-issued owner binding and `HERDR_SOCKET_PATH` exist in the runtime environment.

## Terminal management actions

Within a conversation, users invoke `/terminal` and agents invoke `herdr_terminal`. Both interfaces support the following actions:

- `list`: Enumerate active terminals.
- `create`: Create a new terminal tab (creation is non-focusing).
- `run`: Execute a command in a terminal.
- `send`: Send input characters or keystrokes to a terminal.
- `read`: Read captured output from a terminal.
- `wait`: Wait for a running command to finish.
- `status`: Inspect terminal process status.
- `focus`: Explicitly switch focus to the target terminal.
- `close`: Terminate and close a terminal.

Closing a busy terminal requires explicit confirmation; the initial close request is rejected unless repeated with `force: true` (or `/terminal close <TERMINAL_NAME> --force`).

## Security and isolation

Ownership isolation is enforced through a randomly generated `xcsh_owner` metadata token attached to the workspace and each managed pane. `xcsh` only lists, reads, interacts with, focuses, and terminates panes bearing the active binding token. Terminals belonging to other conversations or users remain hidden.

Session creation, resumption, switching, branching, and tree navigation retain the existing workspace and tabs while updating the stored `xcsh` session reference.

## Socket protocol and resilience

The socket client communicates using Herdr protocol 18 over newline-delimited JSON across `HERDR_SOCKET_PATH`. Each request establishes an independent connection, validates the `ping` protocol version, enforces a 4 MiB response cap, and applies bounded timeouts to prevent Herdr restarts from blocking the primary conversation process.

