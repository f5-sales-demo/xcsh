---
name: xcsh-issue-intake
description: Install, run, or inspect the 15-minute Ubuntu timer for f5-sales-demo/xcsh issue intake through Codex CLI and Herdr.
---

# xcsh issue intake

Codex CLI has no built-in Scheduled task manager. This skill sets up an Ubuntu
user systemd timer; each tick runs the repository watcher, which uses Codex CLI
for issue assessment and Herdr Codex CLI delivery sessions. No Mac scheduler is
required.

Read `docs/issue-intake.md` before activation. Verify merged source, the
immutable activation checkpoint, the dedicated Herdr session and owner-only
Ubuntu lease. Install the repository's service and timer units as documented,
then check both `xcsh-issue-intake.timer` and
`xcsh-issue-intake-lease.timer` and their first service results. The
five-minute renewal timer keeps the Herdr lease alive between 15-minute issue
polls. A skill provides the repeatable procedure; systemd supplies the clock.

For a manual run, use `systemctl --user start xcsh-issue-intake.service` on
Ubuntu, then inspect `python3 scripts/issue_intake.py status` and
`journalctl --user -u xcsh-issue-intake.service`. The watcher lock makes
overlapping ticks safe. Re-pair from a managed Herdr pane after lease expiry,
revocation, or server restart. Do not reset the checkpoint or copy the lease
into Git. Herdr activity alone does not establish issue delivery completion.
