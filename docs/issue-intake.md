# Scheduled issue intake

An Ubuntu user systemd timer supplies the 15-minute clock. Its service runs
`scripts/issue_intake_worker.py`, which resolves an owner-only Herdr lease and
starts the Ubuntu watcher. The watcher uses Codex CLI for read-only issue
assessment and starts named Herdr Codex CLI sessions for intake or delivery.
GitHub writes remain on Ubuntu. The durable ledger is
`~/.local/state/xcsh-issue-intake/ledger.sqlite3`, outside Git.

## Activation

1. Install merged source in `/data/robin-GIT/xcsh` on Ubuntu; verify
   `git rev-parse HEAD` equals `origin/main`. Keep the dedicated Herdr
   session `xcsh-issue-intake` and its Mac remote entry; leave the existing
   UAT session untouched.
2. In a managed pane of the dedicated Herdr session, issue a worker pairing
   with `herdr context issue` and claim it for the worker with
   `herdr context claim --consumer-id xcsh-issue-intake-ubuntu-worker`.
   Store the lease JSON at
   `~/.local/share/xcsh-issue-intake/herdr.lease` **on Ubuntu** with mode
   `0600` and owner `robin`.
   Never put the pairing, lease, or resolved environment in Git or logs.
3. Run `python3 scripts/issue_intake_worker.py --check` on Ubuntu. It resolves
   the pairing without polling issues.
4. Run `python3 scripts/issue_intake.py activate` **once** on Ubuntu. This
   records the newest GitHub issue or PR number as an immutable checkpoint;
   older backlog items remain excluded even if they change.
5. Manually run `python3 scripts/issue_intake_worker.py` and inspect
   `python3 scripts/issue_intake.py status`. A successful empty run reports
   `{}`; a failed run leaves the issue queued for retry.
6. Install and start the user timer on Ubuntu:

```sh
install -d -m 700 ~/.config/systemd/user
install -m 644 scripts/systemd/xcsh-issue-intake.service ~/.config/systemd/user/
install -m 644 scripts/systemd/xcsh-issue-intake.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now xcsh-issue-intake.timer
systemctl --user list-timers xcsh-issue-intake.timer
```

Verify `loginctl show-user robin -p Linger` reports `yes`, then inspect
`systemctl --user status xcsh-issue-intake.timer` and
`journalctl --user -u xcsh-issue-intake.service` after its first tick.
The timer runs on quarter-hour wall-clock boundaries and `Persistent=true`
catches up a missed tick.

The worker resolves the lease on every run. The watcher takes an exclusive
lock, so overlapping runs return `already-running`; failed service calls
leave issues queued. Deterministic tab and agent names let retries reuse an
existing session.

## Review and recovery

`python3 scripts/issue_intake.py status` reports the checkpoint and counts by
state. For row-level diagnosis, use a read-only SQLite query on Ubuntu.
`intake` means missing decisions were requested; `held` means a status label
or assessment hold; `queued` means waiting for capacity or retry;
`delivery` means a named Codex session was dispatched. At most two deliveries
may be active. A closed issue previously in delivery is
`closed_unverified` until its linked PR, checks, merge, and cleanup are
confirmed. Herdr state alone never proves completion.

Never reset the checkpoint or delete the ledger to make old issues appear new.
After a crash, inspect the named Herdr tab and GitHub activity before manual
action. Revoke and rotate a retired lease from a managed Herdr pane.
