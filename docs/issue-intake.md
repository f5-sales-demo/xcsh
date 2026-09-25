# Scheduled issue intake

The Mac Codex desktop task supplies the timer. The trigger reads an owner-only
Herdr lease and invokes the Ubuntu worker over SSH. Ubuntu performs GitHub
reads, read-only Codex assessment, worktree creation, Herdr dispatch, and any
GitHub writes made by the delivery sessions. The ledger is
`~/.local/state/xcsh-issue-intake/ledger.sqlite3` on Ubuntu, outside Git.

## Activation

1. Install the merged source in `/data/robin-GIT/xcsh` on Ubuntu and confirm
   `git rev-parse HEAD` equals `origin/main`. Use the dedicated Herdr session
   `xcsh-issue-intake` and the matching Mac remote machine. Keep the existing
   UAT session untouched.
2. From a managed pane in that Ubuntu session, issue a worker pairing with
   `herdr context issue`. Claim the payload once with consumer ID
   `xcsh-issue-intake-mac-worker` using `herdr context claim`. Store the returned
   lease JSON at `~/.local/share/xcsh-issue-intake/herdr.lease` on the Mac with
   mode `0600`. Do not put the pairing, lease, or resolved environment in Git or
   task output. The worker resolves the lease on every run.
3. On the Mac, run `python3 scripts/issue_intake_trigger.py --check`. This
   validates the SSH route and Herdr pairing without polling issues.
4. On Ubuntu, run `python3 scripts/issue_intake.py activate` once. It records the
   newest GitHub issue or PR number as an immutable checkpoint. All lower
   numbers are excluded from scheduled intake, including later backlog edits.
5. Manually run `python3 scripts/issue_intake_trigger.py` from the Mac project
   and inspect `python3 scripts/issue_intake.py status` on Ubuntu. A successful
   empty run reports `{}`. A nonzero result means the next scheduled run should
   retry after the cause is fixed.
6. In the Codex desktop app, create an in-chat scheduled task for every 15
   minutes in the Mac xcsh project. Use the prompt below and confirm it appears
   as active under **Scheduled**. Keep the Mac powered on and the app running.

```text
Use $xcsh-issue-intake in run mode every 15 minutes. From this xcsh
project directory, run exactly once:
python3 scripts/issue_intake_trigger.py

Report the exit status and the watcher's concise JSON summary. If SSH,
GitHub, Herdr pairing, or dispatch fails, report the failure and let the
next run retry. Do not directly assess issues or create a second watcher.
```

The repository skill `.agents/skills/xcsh-issue-intake` packages the desktop
setup and scheduled run prompt. It does not supply a timer; Codex desktop
Scheduled owns the recurrence. The trigger accepts `--check` for a pairing test. It never prints the lease.
Its remote worker accepts only the Herdr context fields returned for the
dedicated session. The watcher uses an exclusive lock, so overlapping runs
return `already-running`; it serializes assessment and dispatch. Failed service
calls leave an issue queued. Tab labels and agent names are deterministic, so a
retry can reuse a previously started session.

## Review and recovery

`python3 scripts/issue_intake.py status` reports the checkpoint and counts by
state. For row-level diagnosis, use a read-only SQLite query against the ledger
on Ubuntu. `intake` means missing decisions were requested; `held` means a
status label or assessment hold; `queued` means waiting for capacity or retry;
`delivery` means a named Codex session was dispatched. Two deliveries may be
active at once. A closed issue previously in delivery is
`closed_unverified` until its linked PR, checks, merge, and cleanup are
confirmed. Herdr state alone never proves completion.

The watcher does not reset or advance the checkpoint on retries. Never delete
its ledger to make an issue appear new. If a dispatched agent is uncertain
after a crash, inspect the named Herdr tab and GitHub activity before taking
manual action. Revoke a retired worker lease with `herdr context revoke` and
pair its replacement from a managed pane.
