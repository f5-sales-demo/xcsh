# xcsh Todo Sidebar Rollout — HANDOFF

**Date:** 2026-04-23
**Author:** Robin Mordasiewicz (with Claude Code assistance)

---

## 1. What we're building

A togglable todo sidebar for the xcsh TUI that subsumes issue [#239](https://github.com/f5xc-salesdemos/xcsh/issues/239) (duplicate `todo_write` transcript blocks). Four-PR rollout, layered bottom-up.

| PR | Scope | Status |
|----|-------|--------|
| **PR 0** | pi-tui chord keybinding support | ✅ Merged — [#251](https://github.com/f5xc-salesdemos/xcsh/pull/251) (closes [#252](https://github.com/f5xc-salesdemos/xcsh/issues/252)) |
| **PR 1** | pi-tui foundation: `HorizontalSplit`, `TypedEventEmitter`, ANSI utility | ✅ Merged — [#261](https://github.com/f5xc-salesdemos/xcsh/pull/261) |
| **PR 2** | Sidebar + transcript changes (closes [#239](https://github.com/f5xc-salesdemos/xcsh/issues/239)) | 🟡 Open — [#283](https://github.com/f5xc-salesdemos/xcsh/pull/283), CI green. **Not merged — pending user review.** |
| **PR 3** | HTML export coherence | 🔴 Not started. Plan not yet written. Depends on PR 2. |

---

## 2. Current state (where to resume)

### PR #283 — `feat(coding-agent): sidebar + transcript`

- **URL:** <https://github.com/f5xc-salesdemos/xcsh/pull/283>
- **Branch:** `feat/pi-tui-sidebar` (pushed to origin)
- **Head SHA:** `f8e9b0a67ff0f1e1aebb6e8018cd5f3655dd759e`
- **CI:** All checks green (check, test, native builds, Require Linked Issue)
- **Issue:** Closes #239 (auto-closes on merge)
- **Status:** Do NOT auto-merge — user reviews before merge

### Worktree

- **Location:** `/workspace/xcsh/.worktrees/todo-write-dedup`
- **Branch:** `feat/pi-tui-sidebar` (20 commits ahead of main after rebase)
- This worktree may not survive a container restart — see recovery instructions below.

---

## 3. What PR 2 implements

- `packages/coding-agent/src/session/agent-session.ts` — `TypedEventEmitter<AgentSessionEvents>` on `AgentSession`; emits `todoPhasesChanged` and `reminderFired`
- `packages/coding-agent/src/modes/components/sidebar/` — new directory:
  - `sidebar-section.ts` — abstract base class with mount/unmount lifecycle
  - `sidebar-component.ts` — queueMicrotask-coalesced section container
  - `todos-section.ts` — subscribes to `todoPhasesChanged`, renders live todo phases
  - `reminders-section.ts` — subscribes to `reminderFired`, renders reminder notices
- `packages/coding-agent/src/modes/controllers/event-controller.ts` — skips `todo_write` in streaming + `tool_execution_start`; emits `reminderFired` to session events (removes inline `TodoReminderComponent`)
- `packages/coding-agent/src/modes/utils/ui-helpers.ts` — skips `todo_write` blocks in `renderSessionContext` (fixes #239)
- `packages/coding-agent/src/modes/interactive-mode.ts` — major refactor: HorizontalSplit layout, chord pipeline wired, old inline todo list removed
- `packages/coding-agent/src/modes/controllers/input-controller.ts` — installs chord hook for `app.sidebar.toggle`
- `packages/coding-agent/src/modes/components/custom-editor.ts` — adds `setChordHook()` API
- `packages/coding-agent/src/config/keybindings.ts` — `app.sidebar.toggle` bound to `ctrl+x b`
- `packages/coding-agent/src/config/settings.ts` + `settings-schema.ts` — `sidebar.visible` (default true), `sidebar.width` (default 32)

---

## 4. After resuming — immediate next steps

1. **Review PR #283** — <https://github.com/f5xc-salesdemos/xcsh/pull/283>
2. **Merge PR #283** when satisfied — delegate to `f5xc-github-ops:github-ops`:

   ```
   Agent(
     subagent_type="f5xc-github-ops:github-ops",
     mode="bypassPermissions",
     prompt="Merge PR #283. Confirm CI is still green before merging."
   )
   ```

3. After PR 2 merges, issue #239 auto-closes. Confirm closure.
4. **Author PR 3 plan** via `writing-plans` skill against spec §8 (HTML export coherence).
5. **Execute PR 3 plan** via `subagent-driven-development` skill.

---

## 5. Recovery instructions (if worktree was lost)

If `/workspace/xcsh/.worktrees/todo-write-dedup/` is gone:

```bash

cd /workspace/xcsh
git fetch origin
git worktree add .worktrees/todo-write-dedup feat/pi-tui-sidebar
cd .worktrees/todo-write-dedup
bun install
bun --cwd=packages/natives run build
```

PR #283 branch (`feat/pi-tui-sidebar`) is pushed to origin — all 20 commits are safe.

---

## 6. Governance rules (must honor on every resume)

1. **Commits/pushes/PRs delegate to `f5xc-github-ops:github-ops` with `mode="bypassPermissions"`.** The `enforce-git-delegation` hook blocks direct git mutations.
2. **`docs/superpowers/` is gitignored by governance** — never commit specs or plans there.
3. **`.gitignore` is governance-protected** — do not amend locally.
4. **Pre-run `bunx @biomejs/biome check --write <files>` before staging** — `biome format --write` alone does NOT fix import ordering.
5. **`Refs #N`** in intermediate commits; **`Closes #N`** in the final PR body only.

---

## 7. Baseline test failures to ignore

- **pi-tui**: 8 failures in `render-regressions.test.ts` and `overlay-scroll.test.ts` (pre-existing)
- **coding-agent**: 2-3 failures in `tryAutoConfigLiteLLM()`, `validateModelsConfig()`, occasional sdk-skills timeouts (pre-existing, flaky)

---

## 8. PR 2 commit list (for reference)

```
f8e9b0a67 test(coding-agent): lock sidebar-toggle hint-once state machine
cfc997821 feat(coding-agent): wire sidebar into interactive-mode, complete chord pipeline
403e8fa65 feat(coding-agent): bind app.sidebar.toggle to Ctrl+X B (chord)
5b3d77cbe feat(coding-agent): add sidebar.visible and sidebar.width settings
4c239acba test(coding-agent): lock cold-start no-empty-flash invariant
6d245c877 test(coding-agent): lock burst-coalesce invariant for sidebar renders
e6bc67060 test(coding-agent): lock event-controller pendingTools null-safety invariant
db67265b1 fix(coding-agent): replay path skips todo_write content blocks
be1bac044 feat(coding-agent): event-controller skips todo_write in message_update streaming
9a6fbbb13 feat(coding-agent): event-controller skips todo_write in tool_execution_start
20b8520b3 feat(coding-agent): RemindersSection migrates reminder render to sidebar
f81388455 test(coding-agent): baseline TodoReminderComponent contract before migration
a6492f951 feat(coding-agent): event-controller emits reminderFired on todo_reminder
d9dc7ea8c feat(coding-agent): TodosSection renders phases from AgentSession.events
e93956512 feat(coding-agent): SidebarComponent renders sections or dim "no active sections" line
81dd16af8 feat(coding-agent): SidebarComponent coalesces markSectionDirty via microtask
720938049 feat(coding-agent): SidebarComponent skeleton with factory pattern
f173753d3 feat(coding-agent): add SidebarSection abstract base
7e18487f4 feat(coding-agent): AgentSession emits todoPhasesChanged on setTodoPhases
09988ffc8 feat(coding-agent): add AgentSession.events typed emitter
```
