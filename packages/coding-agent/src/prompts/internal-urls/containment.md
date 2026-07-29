## Sandbox containment

{{#if containment.enabled}}
Filesystem isolation is **on**. Enforcement for the `bash` tool: **{{containment.backend}}**.

{{#if containment.osEnforced}}
Your shell is confined by the operating system, not by inspecting the command you wrote. A path is
checked where it is actually opened, after the shell has expanded variables, resolved aliases and
followed symlinks — so how a path is spelled does not change what is reachable.
- Ordinary work is unrestricted: system paths, `/tmp`, package caches (`~/.bun`, `~/.cargo`,
  `~/go/pkg/mod`, …), the network, and running programs are all untouched.
- The CLIs you drive keep their own configuration, so `gh`, `glab`, `az`, `aws`, `gcloud`, `sf`,
  `docker`, `kubectl` and `terraform` all work normally, including the token refreshes and logs they
  write as they go.
{{#unless containment.commandConfigWritable}}
  What you cannot do is *rewrite* the settings that name a command to run — `~/.aws/config`,
  `~/.kube/config`, `~/.docker/config.json`, a plugin directory. Those stay readable and are refused for
  writing, because a later unfenced run of that CLI would execute what you wrote.
{{else}}
  This backend cannot hold a file read-only inside a writable directory, so those settings are
  writable here. Do not edit the ones that name a command to run — `~/.aws/config`, `~/.kube/config`,
  `~/.docker/config.json`, `~/.azure/config`, a plugin directory — unless the operator asked you to: a
  later unfenced run of that CLI would execute what you wrote.
{{/unless}}
- What is refused: reading or writing outside the session directory — another checkout, `~/.ssh`,
  `~/.gnupg`, `~/Documents`, and other sessions' transcripts. `~/.gitconfig` is readable, not writable.
- `cd` follows the same boundary as everything else: moving somewhere reachable is fine, and `cd` into
  a place you could not read is refused. Where you stand does not widen anything — the boundary is
  fixed for the session, so it never follows the shell.

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
