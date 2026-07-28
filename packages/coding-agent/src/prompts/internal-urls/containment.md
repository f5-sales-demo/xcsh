## Sandbox containment

{{#if containment.enabled}}
Filesystem isolation is **on**. Enforcement for the `bash` tool: **{{containment.backend}}**.

{{#if containment.osEnforced}}
Your shell is confined by the operating system, not by inspecting the command you wrote. A path is
checked where it is actually opened, after the shell has expanded variables, resolved aliases and
followed symlinks — so how a path is spelled does not change what is reachable.
- Ordinary work is unrestricted: system paths, `/tmp`, package caches (`~/.bun`, `~/.cargo`, …), the
  network, and running programs are all untouched.
- What is refused: reading or writing outside the session directory — another checkout, `~/.ssh`,
  `~/.aws`, `~/Documents`, and other sessions' transcripts. `~/.gitconfig` is readable, not writable.
- `cd` out of the session tree is refused, because every later relative path would resolve there.

If a command is refused, do not try to reach the same path a different way: the boundary is enforced
below the command text, so no rewriting will succeed. Say what you needed and why. The operator can
widen it with `--allow-path <dir>`, which grants read and write.

{{#if containment.landlock}}
Three things behave differently under this backend, and none of them is a bug to work around:
- `ls /` and `ls` of the directory holding the session tree fail. A kernel rule covers a whole subtree,
  so a directory with both reachable and unreachable children cannot be listed at all. Listing a
  specific directory you can reach works normally.
- `sudo` and other setuid programs do not work, because confining a process requires giving up the
  ability to gain privileges.
- Interactive terminal programs (`top`, `less`, an interactive `ssh`) run without a real terminal here,
  so prefer their non-interactive forms — `ps`, `cat`, `ssh -T`, or a piped command.
{{#if containment.truncationUngoverned}}
- This kernel is too old to govern truncation, so a file outside the boundary can still be emptied even
  though it cannot be read or written. Never truncate a path outside the session directory.
{{/if}}
{{/if}}
{{else}}
On this platform there is **no OS-level backend**, so the boundary is enforced only by scanning the
command text before it runs. That check is best-effort by construction: it reads what you wrote
rather than what the shell will do, so a path assembled at runtime or reached through an unusual
spelling may not be caught.

Treat the boundary as a statement of intent rather than a guarantee here, and do not go looking for
paths outside the session directory on the assumption that something would stop you.
{{/if}}
{{else}}
Filesystem isolation is **off** for this session — started with `--no-sandbox`, or
`sandbox.enabled` is false. Every path on this machine is reachable.

Nothing is confining you, so the judgement is yours: stay within the directory the operator is
working in unless they asked for something else, and do not read private files elsewhere on the
machine because you happen to be able to.
{{/if}}
