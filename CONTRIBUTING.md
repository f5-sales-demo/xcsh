# Contributing to xcsh

This repository's contribution guidance is split in two:

- **[DEVELOPING.md](DEVELOPING.md)** — the repository-specific engineering guide: prerequisites,
  project structure, setup, the TDD workflow, linting and formatting, testing (including the
  resource-constrained and OOM-safe guidance), release automation, and the architecture overview.
- **[CLAUDE.md](CLAUDE.md)** — the fleet-wide workflow rules: branch from `origin/main`, work on a
  feature branch, open a pull request linked to an issue, and let the required checks gate the merge.

## Fleet governance

This file is becoming a managed file, synced from
[docs-control](https://github.com/f5-sales-demo/docs-control) like `CLAUDE.md` already is. When that
lands it will carry the full fleet contribution process — issues, branches, pull requests, review,
branch protection, and the Engineering Standards — and it will replace this page.

Nothing is lost in that transition: everything specific to this repository now lives in
[DEVELOPING.md](DEVELOPING.md), which is not managed and stays under this repository's control.

See docs-control#859 and f5-sales-demo/xcsh#2605 for the sequencing.
