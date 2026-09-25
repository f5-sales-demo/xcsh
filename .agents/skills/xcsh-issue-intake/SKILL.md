---
name: xcsh-issue-intake
description: Set up or run the 15-minute Codex desktop scheduled task that triggers Ubuntu GitHub issue intake for f5-sales-demo/xcsh. Use only for this repository's scheduled issue watcher.
---

# xcsh issue intake

This skill connects Codex desktop's built-in Scheduled timer to the repository's
Mac trigger. A skill does not provide a timer by itself. Codex CLI can validate
and run the trigger, but cannot create or manage Scheduled tasks.

## Set up the recurring task

Work from the Mac xcsh Git checkout. Read `docs/issue-intake.md` for the
activation order and evidence. Verify the owner-only Herdr lease exists, then
run `python3 scripts/issue_intake_trigger.py --check`. On Ubuntu, confirm the
watcher was activated once with a checkpoint that excludes the existing
backlog. Run the trigger manually and inspect the Ubuntu ledger status.

In Codex desktop, create an **in-chat scheduled task every 15 minutes** for
this project. Use this durable scheduled prompt:

```text
Use $xcsh-issue-intake in run mode. From this xcsh project directory, run
python3 scripts/issue_intake_trigger.py exactly once. Report its exit status
and concise JSON summary. If SSH, GitHub, Herdr pairing, or dispatch fails,
report that result; the next run retries from the Ubuntu ledger. Do not
assess issues directly or start a second watcher.
```

Confirm the task is active in **Scheduled** and review its first runs. If the
Scheduled interface is absent, provide this prompt for a desktop session and
state that the timer is not active. Do not substitute launchd or system cron.

## Run mode

Run `python3 scripts/issue_intake_trigger.py` once from the Mac xcsh checkout.
It sends the Herdr lease over SSH stdin to Ubuntu and prints only the watcher
summary. Do not read, paste, log, or commit the lease. Do not reset the
activation checkpoint to include old issues. Herdr activity is session state;
issue, PR, checks, and test evidence establishes delivery completion.
