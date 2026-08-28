# xcsh portable-pty patch

This directory vendors portable-pty 0.9.0 from crates.io (upstream repository:
https://github.com/wezterm/wezterm, MIT license).

xcsh adds one Unix `SlavePty::spawn_command_with_pre_exec` hook. The native PTY path uses it to
apply the same prepared Landlock ruleset as the non-PTY shell child before portable-pty performs its
terminal setup. The callback follows `CommandExt::pre_exec`'s post-fork safety contract and is
registered first.

Keep the patch until upstream exposes an equivalent child hook. When upgrading, verify Linux PTY
containment with `packages/coding-agent/test/sandbox-containment-pty.int.test.ts`.
