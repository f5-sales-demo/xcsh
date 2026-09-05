# xcsh documentation quality contract

This contract applies to every authored English page under `docs/en/`. It turns editorial review and executable evidence into repository checks; it is not a page template.

## Plan around a reader question

Every page and heading answers one distinct question for a named audience. Record that question, the content purpose, product authority, and evidence identifiers in `inventory.json`.

Classify each page as one of:

- **landing:** routes readers to a small set of goals.
- **overview:** explains boundaries and helps readers choose.
- **tutorial:** teaches through a complete, safe learning sequence.
- **how-to:** completes one operational task.
- **concept:** explains how or why one mechanism works.
- **reference:** provides facts readers look up.
- **troubleshooting:** starts from an observed symptom and gives a tested remedy.

Merge overlapping questions into one canonical page. Delete a page or heading that has no unique reader need. Do not preserve deleted URLs with compatibility redirects in this prerelease site.

Sources: [Microsoft content planning](https://learn.microsoft.com/en-us/style-guide/content-planning) and [scannable content](https://learn.microsoft.com/en-us/style-guide/scannable-content/).

## Write only useful sections

Do not impose `Prerequisites`, `Procedure`, `Expected result`, `Troubleshooting`, or `Next steps` on every page. Add one only when its contents are specific to the task. Headings should expose the reader's decision or question, not the writer's outline.

Keep sentences direct, use familiar words, place the important condition first, and remove throat-clearing. Define a product concept once at its canonical location and link to it elsewhere.

Sources: [Microsoft concise writing](https://learn.microsoft.com/en-us/style-guide/word-choice/use-simple-words-concise-sentences) and [localization guidance](https://learn.microsoft.com/en-us/style-guide/global-communications/writing-tips).

## Make procedures executable

A procedure must:

1. State the exact scope and any destructive effect.
2. Use imperative steps in the order a reader runs them.
3. Include complete commands with literal flags accepted by the tested version.
4. Separate validation, preview, mutation, and verification.
5. Show an observed, transcript-backed outcome instead of saying that a command "reports completion."
6. Include cleanup when the test creates durable state.

Use a `console` or `output` block only for captured output. Do not hand-author plausible output. Troubleshooting entries name the observed symptom, the isolating check, and a remedy exercised against the same layer.

Sources: [Microsoft procedures and instructions](https://learn.microsoft.com/en-us/style-guide/procedures-instructions/), [step-by-step guidance](https://learn.microsoft.com/en-us/style-guide/procedures-instructions/writing-step-by-step-instructions), [AWS tested CLI examples](https://github.com/awsdocs/aws-doc-sdk-examples/blob/main/aws-cli/README.md), and [AWS integration-test practice](https://github.com/awsdocs/aws-doc-sdk-examples/blob/main/.tools/test/README.md).

## Tie claims to authority and evidence

Product claims must name at least one authority in the inventory: current source, schema, generated help, test, release metadata, or companion-project manifest. Marketing inference and adjacent success are not authorities.

Evidence is required for commands presented as procedures, literal outputs, behavioral outcomes, browser paths, and live service claims. Each entry in `evidence/manifest.json` records:

- immutable source digest;
- xcsh version;
- exact command or bounded command sequence;
- exit status;
- verification level (`source-inspected`, `executed-offline`, `executed-live`, or `browser-observed`);
- cleanup result;
- affected page and heading identifiers;
- SHA-256 digest of the sanitized receipt.

Receipts must omit credentials, tenant identifiers, personal data, raw context files, and unnecessary service payloads. Evidence from the candidate worktree is required for candidate documentation; a globally installed release alone is insufficient.

## Treat interfaces according to evidence

Terminal, offline configuration, and resource commands can be procedural when their transcript exists. Chrome procedures require browser evidence. VS Code and Office click paths require an actual host transcript; without one, limit those pages to source-verified capabilities and boundaries.

## Preserve localization boundaries

English source stays exclusively under `docs/en/`. Keep `docs/llms-config.json` at the docs root with locale-relative selectors. Do not author translated copies or change translation release policy as part of an English content correction. Use short sentences, explicit nouns, stable terminology, and examples that do not rely on wordplay.

## Preserve legacy knowledge explicitly

`legacy-concepts.json` freezes the pre-#3669 English corpus at commit `95c019fa60c8a8242482b18c45844ec73784ee11` and tree `89566cca8d13cd69fb8af9ee017e9860d303b2f2`. Each legacy H2 is one knowledge unit; its dependent H3 material belongs to the same unit.

Inventory schema v2 assigns every stable concept ID to exactly one current page heading. A concept records its reader question, concise knowledge summary, disposition, destination, current authorities, and evidence identifiers.

`corrected` and `superseded` records also explain why the legacy statement is no longer presented as current behavior. The ledger is an audit input, not published legacy prose and not a compatibility route.

The checker rejects baseline drift, missing or duplicate IDs, unknown mappings, stale pages or headings, absent current authority, missing evidence, and an unexplained correction or supersession.

## Automated rejection rules

Run:

```sh
python3 scripts/check_docs_quality.py
python3 -m unittest tests.test_docs_quality
```

The checker rejects:

- the known five-section boilerplate and unsupported generic success claims;
- substantive prose duplicated between pages;
- an MDX page or heading absent from the inventory;
- an inventory entry whose page or heading no longer exists;
- missing, modified, orphaned, or unreferenced evidence;
- output blocks and procedure/outcome headings without evidence;
- page or heading inventory entries without a reader need and purpose;
- pages without a source authority.

The Git pre-commit hook runs the checker when documentation-quality or English MDX files are staged. Set `XCSH_DOCS_QUALITY_CHECK=0` only for an intermediate local commit that cannot yet contain a complete cross-file inventory; CI never uses that escape hatch. `bun run ci:check:full` always runs the checker and its fixture suite.
