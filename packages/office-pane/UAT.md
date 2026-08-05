# Office pane — UAT acceptance checklist

Manual acceptance tests for the xcsh Office task pane. The Office.js host tools and
the pane UI run inside the real host app (Excel, Word, PowerPoint); there is no
headless Office runtime, so these cannot be exercised by CI. CI and the unit tests
verify each tool's API *shape* against a faithful mock — this checklist verifies the
real behavior in the app. Re-run the relevant section after any release that touches
the pane, the host tools, or the chat engine.

For workstation dependencies, architecture, focused test commands, synthetic-data
rules, build and sideload procedures, release verification, and troubleshooting, use
the [Office add-in development guide](DEVELOPING.md).

## Setup

1. Install the build under test (`brew upgrade xcsh`; confirm `xcsh --version`).
2. From the working directory you want the pane scoped to, sideload and serve in one
   command — it registers the add-in, then serves and blocks until Ctrl+C:
   `cd /tmp/xcsh-office-cwd && xcsh office sideload excel|word|powerpoint`.
   The directory matters: the sandbox confines the pane's file tools and its shell to it.
3. Open the **xcsh** pane in the target app.
4. Record the version and the pass/fail of each row.

`xcsh office serve` still exists for a pane that is already registered (re-serving after a
restart, or pointing an existing add-in at a different folder).

Legend: **Fix** names the issue the row validates.

## Excel

Fixture: a workbook with several sheets, at least one named Table, one named range
that points at a cell range, one defined name that points at a constant or formula,
and one empty sheet.

| # | Action / prompt | Expected | Fix |
| --- | --- | --- | --- |
| E1 | "summarize the structure of this workbook" | Activity shows "Reading workbook structure ✓"; the answer lists sheets, Tables, and named ranges. No "get_workbook_info errored / falling back" message. | #2260 |
| E2 | "read the `<TableName>` table" | Returns the Table's **data rows only** — the first returned row is real data, not the column headers (headers are returned separately as column names); no totals row leaks in. | #2267 |
| E3 | "read the named range `<rangeName>`" (a real cell range) | Returns the range's values and address. | Excel tools |
| E4 | Define a name as a constant (for example `taxRate` = `=0.2`), then "read the named range `taxRate`" | A clear message that the name is not a cell range — not a crash or an empty result. | #2267 |
| E5 | Select the empty sheet, then "summarize this sheet" | No `ItemNotFound` crash from the structure read. | #2231 |
| E6 | "read `Sheet2!A1:C3`" | Cross-sheet values returned. | Excel tools |
| E7 | "show the formulas in `A1:B5`" | Formulas (not just values) returned. | Excel tools |
| E8 | "sort the `<TableName>` table by `<column>` descending" | The Table re-sorts in the sheet. | Excel tools |
| E9 | "what is the number format and type of `A1`" | Cell metadata returned. | Excel tools |
| E10 | "list the sheets" | All sheet tab names returned. | Excel tools |
| E11 | "write `hello` into `Z1`" | The cell updates in the sheet. | Excel tools |

## Word

Fixture: a document with at least one comment and one tracked change (an insertion),
several styled paragraphs, and a text selection.

| # | Action / prompt | Expected | Fix |
| --- | --- | --- | --- |
| W1 | "read the tracked changes" | Each revision shows its text, an author (populated, not blank), and a type of `Added` / `Deleted` / `Formatted` — never `Inserted`. | #2264 |
| W2 | "read the comments" | Each comment's text and author. | Word tools |
| W3 | "outline the document structure" | Section count, heading outline, word count, and whether comments / tracked changes exist. | Word tools |
| W4 | "read the paragraphs with their styles" | Paragraph text with style names (Heading 1, Normal, …). | Word tools |
| W5 | Select some text, then "read my selection" | The selected text is returned. | Word tools |
| W6 | "insert a paragraph 'Summary' at the end" | The paragraph is added. | Word tools |

## PowerPoint

Fixture: a deck where at least one slide contains a **table or an image** alongside
normal text shapes.

| # | Action / prompt | Expected | Fix |
| --- | --- | --- | --- |
| P1 | "read all the slides" | Text from text-bearing shapes is returned; the deck with a table / image does **not** crash ("read_slides errored"). | #2266 |
| P2 | "read the shapes on slide 1" | Every shape is listed with its name, type, and geometry; text-bearing shapes include their text; the table / image is listed without text and without error. | #2266 |
| P3 | "set the text of the table shape to 'x'" | A friendly "can't hold text" message — not a raw `InvalidArgument`. | #2266 |
| P4 | "read the layout of slide 1" | Layout and master names returned. | PowerPoint tools |
| P5 | "add a slide" then "add a text box saying 'Agenda'" | A slide and a text box are added. | PowerPoint tools |
| P6 | "set the text of the title shape to 'Q3 Review'" | The title text updates. | PowerPoint tools |

## Pane UI (any surface)

| # | Action | Expected | Fix |
| --- | --- | --- | --- |
| U1 | Ask a question whose answer contains a long code block or a long URL | Text wraps within the pane; nothing is clipped at the right margin. | #2272 |
| U2 | Trigger a tool that fails (for example, on a deck with a table, try P3's edit) | The activity row shows a ✗ and "failed" — not a ✓. | #2275 |
| U3 | Watch a reply as it streams | A blinking caret follows the streaming text; it stops when the answer settles. | #2244 |
| U4 | Ask something that cites F5 documentation or console links | A "Sources" chip row appears beneath the answer; each chip is a clean clickable link (no trailing `*` or backtick). | #2237 / #2250 / #2257 |
| U5 | After a few turns, click "New chat" | The transcript clears; the next answer shows no memory of the prior conversation. | #2244 |

## Server reliability

| # | Action | Expected | Fix |
| --- | --- | --- | --- |
| S1 | With a server already running, run `xcsh office serve` again | The new one reports it superseded the previous server and binds; no "port 8444 in use" error. | #2241 |
| S2 | Run `xcsh office serve` from a large directory (for example the home directory) | It comes up quickly, with no "system prompt preparation timed out" warning. | #2246 |
| S3 | `brew upgrade` while a server is running | The upgrade's post-install step recycles the running server. | #2241 |
| S4 | Run `xcsh office recycle` with a server running, then with none | First stops the running server; second reports none is running. | #2241 |
| S5 | `cd /tmp/xcsh-office-cwd && xcsh office sideload excel` | Registers the add-in AND starts serving from that directory, then blocks until Ctrl+C — one command, no separate `serve`. | #2485 |
| S6 | In the pane, ask "what directory are you working in, and list its files" | The answer names the directory the sideload was launched from, not the home directory or a stale one. | #2485 |

## Marketplace plugins (Excel)

Requires an installed plugin that ships commands, skills and a schema. These rows use
`meddpicc@f5-sales-demo-marketplace` (>= 2.2.0) and a folder holding a deal JSON —
sideload from that folder.

| # | Action / prompt | Expected | Fix |
| --- | --- | --- | --- |
| P1 | Open the composer's `/` menu | Lists the plugin's slash commands with their descriptions (`/meddpicc:qualify-deal`, `/meddpicc:deal-review`, …), not an empty menu and not a missing button. | #2480 |
| P2 | Open `+` → Skills | Lists the plugin's skills (`meddpicc:coach`, `meddpicc:deal-review`, …). | #2473 |
| P3 | Send `/meddpicc:meddpicc-status` | The assistant follows the COMMAND — reports schema readiness and inventories the deal files in the working directory. It must not answer *about* the literal string. | #2480 |
| P4 | Send `/meddpicc:qualify-deal <account>` | The argument reaches the command (the reply is about that account, not `$ARGUMENTS`). | #2480 |
| P5 | Ask "generate a meddpicc report" in plain English | Reaches the same place through the skill — no slash command needed. | #2473 |
| P6 | During P4/P5, watch for a new worksheet | A sheet named after the deal is created and populated; the sheet you started on is not overwritten. Re-running overwrites that sheet rather than adding a duplicate tab. | #2476 |
| P7 | Ask "show me the meddpicc schema" | The assistant reads it via `xcsh://plugin/meddpicc/schema` and does not claim plugin resources are unavailable. | #2476 |

## Multi-model MEDDPICC certification

The release-certification harness runs the same five prompts used in the team
presentation against a real `xcsh office serve` bridge and the production Excel
tool definitions. It uses a stateful workbook fake for the automated gate; repeat
the printed prompts in desktop Excel for the final Office.js and WebView check. The
harness also proves live inference through the default GPT-5.6 Sol, switches to
Claude Opus 5, and switches back to GPT-5.6 Sol before it exercises the deal
workflow. Under the restored GPT model, it reads a generated synthetic PNG first
as an Office attachment and then through file-based `inspect_image`.

Prerequisites:

1. Install `meddpicc@f5-sales-demo-marketplace` version 7.5.6.
2. Export `LITELLM_BASE_URL` as the HTTPS gateway root (for example,
   `https://gateway.example.com`) and export `LITELLM_API_KEY`. xcsh derives the
   provider-specific API path from the selected model. Legacy values that include a
   provider path are reduced to the same gateway root.
3. Build xcsh, or choose the exact installed release binary to certify.
4. Ensure port 8444 is free. The harness refuses to supersede a server it did not start.

Print the presentation runbook without starting a server:

```bash
bun run --cwd packages/office-pane uat:meddpicc-excel --print-prompts
```

Run the automated local-build gate from the repository root:

```bash
bun packages/office-pane/scripts/uat-meddpicc-excel.ts \
  --binary "$PWD/packages/coding-agent/dist/xcsh" \
  --workspace /tmp/xcsh-meddpicc-demo \
  --fixture "$PWD/../marketplace/plugins/meddpicc/schema/example-deal.json" \
  --evidence /tmp/xcsh-meddpicc-local.json
```

For the published gate, use the exact Homebrew binary and a separate evidence file.
The fixture must be synthetic and represent every person with a reserved role alias
such as `<CHAMPION>` or `<ACCOUNT_EXECUTIVE>`. The harness refuses other identity
values before starting Office, copies the canonical fixture into the workspace as
`example-corp.json`, checks its SHA-256 and plugin version, runs all five steps,
reruns step 5 for idempotency, and stops only the `office serve` child it spawned.
It records responses, tool traffic, timings, assertions, and before/after workbook
snapshots alongside the build identifiers. Vision evidence records only the PNG
hash, size, MIME type, timings, and pass/fail state; it excludes image payloads,
probe codes, replies, and credentials.

In desktop Excel, begin with a sheet named `Start` containing a sentinel value. Save
the LiteLLM URL and token with the model field blank, then send the printed prompts.
Confirm the exact `MEDDPICC — Example Corp` A1:B7 summary, one summary tab after a
second step-5 run, an unchanged and still-active `Start` sheet, and successful task-pane
activity cards. Capture one screenshot per step with the version and pass/fail record.

## Coverage notes

- Excel `get_workbook_info` (E1), the pane tool-activity rows, the New-chat control,
  markdown rendering, `history_hint` reset, cited-source cleanliness, and server
  supersede / recycle / large-directory start have been verified in the live app or
  against the running binary.
- The remaining Excel tools (E2–E11), and **all** Word and PowerPoint rows, are
  verified by unit tests against faithful mocks but have not yet been exercised in the
  live app — run those sections in Excel, Word, and PowerPoint respectively.
