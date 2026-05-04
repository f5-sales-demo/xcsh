---
name: gitlab
description: GitLab issue tracking and work item management via glab CLI. Use when the user mentions GitLab, bugs, issues, work items, tickets, or wants to search/view project issues. Triggers onboarding if glab is not configured.
---

# GitLab Issue Tracking

You have 4 tools for interacting with GitLab issues via the `glab` CLI:

- `glab_setup` — onboarding, authentication, project selection
- `glab_issue_list` — list/filter issues with structured params
- `glab_issue_view` — view a single issue with full details + comments
- `glab_search` — full-text search across titles, descriptions, and comments

## Onboarding Flow

Run this sequence when the user first asks about GitLab issues AND no project is configured:

1. Call `glab_setup(action: "check")` — verify glab is installed
2. Call `glab_setup(action: "status")` — check auth and current config
3. If not authenticated: call `glab_setup(action: "login")` and tell the user to open their browser to authorize
4. Call `glab_setup(action: "select_project")` — show available projects
5. After user selects: call `glab_setup(action: "save_project", project: "selected/path")`

**Trigger onboarding when:** the user asks about issues/bugs and the status tool returns no configured project, OR any tool returns a "not configured" error.

## Tool Selection Guide

| User intent | Tool to call |
|-------------|-------------|
| "show me bugs", "list open issues", "issues assigned to alice" | `glab_issue_list` |
| "show issue #42", "view issue details", "what's in ticket 123" | `glab_issue_view` |
| "find issues about Tempus", "search for login timeout", "bugs mentioning Safari" | `glab_search` |
| First setup, not authenticated, no project configured | `glab_setup` sequence |

**Use `glab_search` when:** the query is open-ended text that could match titles, descriptions, OR comments. Use `glab_issue_list` when the user specifies structured filters (assignee, label, state, milestone).

## Output Rules

- **Lists**: Always return the summary table from the tool. Do not reformat — the table is already rendered.
- **Details**: Return the full detail view. Offer to search for related issues if the user seems to be exploring.
- **Empty results**: Suggest refining the search (different state, broader query, check label names).
- **Progressive disclosure**: Start with the list. Only fetch details when the user asks for a specific issue.

## Common Label Namespaces

Many GitLab projects use structured label namespaces. Suggest these when the user wants to filter:

- `customer/<name>` — customer-specific issues
- `priority::high`, `priority::medium`, `priority::normal` — priority levels
- `status::new`, `status::triaging`, `status::investigating` — triage status
- `type::bug`, `type::enhancement`, `type::incident` — issue types
- `area/<team>` — engineering area ownership

Example: "show high priority bugs" → `glab_issue_list(labels: ["priority::high", "type::bug"])`

## Error Recovery

| Error message | Action |
|---------------|--------|
| "No GitLab project configured" | Run `glab_setup` onboarding sequence |
| "GitLab auth error" | Call `glab_setup(action: "login")` |
| "404/403 not found" | Verify project path with `glab_setup(action: "status")`, re-run select_project |
| "glab is not installed" | Show install instructions from `glab_setup(action: "check")` |
