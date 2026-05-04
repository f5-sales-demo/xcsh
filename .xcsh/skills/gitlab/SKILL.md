---
name: gitlab
description: GitLab issue tracking and work item management via glab CLI. Use when the user mentions GitLab, bugs, issues, work items, tickets, or wants to search/view project issues.
---

# GitLab Issue Tracking

You have 4 tools for interacting with GitLab issues via the `glab` CLI:

- `glab_setup` — onboarding, authentication, project selection
- `glab_issue_list` — list/filter issues with structured params
- `glab_issue_view` — view a single issue with full details + comments
- `glab_search` — full-text search across titles, descriptions, and comments

## When No Project Is Configured

If any tool returns **"No GitLab project configured"**, do NOT call `glab_setup(action: "select_project")` — that command requires waiting for a long API list and may be unreliable.

Instead, respond with this EXACT message and stop:

> **GitLab project not configured.** Run this one-time setup:
> ```
> glab_setup with action save_project and project GROUP/NAMESPACE/REPO
> ```
> Replace `GROUP/NAMESPACE/REPO` with your project path (e.g. `f5/volterra/support/zendesk`).
> Once saved, your project is remembered across all sessions.

Only call `glab_setup(action: "check")` and `glab_setup(action: "status")` for diagnostics. Never call `glab_setup(action: "select_project")` as part of an automatic flow — it requires user interaction.

## Tool Selection Guide

| User intent | Tool to call |
|-------------|-------------|
| "show me bugs", "list open issues", "issues assigned to alice" | `glab_issue_list` |
| "show issue #42", "view issue details", "what's in ticket 123" | `glab_issue_view` |
| "find issues about Tempus", "search for login timeout", "bugs mentioning Safari" | `glab_search` |
| "configure GitLab", "set up glab", "save project path" | `glab_setup(action: "save_project", project: "...")` |

**Always try the search/list tool first.** If it fails with "not configured", show the setup message above and stop — do not call multiple tools trying to auto-configure.

## Output Rules

- **Lists**: Return the summary table as-is. Do not reformat.
- **Empty results**: Suggest broadening search (try `state: "all"` to include closed issues).
- **Progressive disclosure**: Show the list first; only fetch issue details when asked.

## Common Label Namespaces

- `customer/<name>` — customer-specific issues
- `priority::high`, `priority::medium`, `priority::normal`
- `status::new`, `status::triaging`, `status::investigating`
- `type::bug`, `type::enhancement`, `type::incident`

Example: "show high priority bugs" → `glab_issue_list(labels: ["priority::high"])`
