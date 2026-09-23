# Remote voice completion acceptance

Issue #3935 is the completion tracker. Automated verification and physical iPhone acceptance are
separate gates.

## Immutable baseline

The rollback baseline is published xcsh v21.37.4:

- executable: `/data/robin-GIT/xcsh-voice/release-v21.37.4-published/xcsh-linux-x64`;
- SHA-256: `2514dbdf4ebb6572f09add97709cda9d55dab50b12735f6cb2a8ea7710aa5223`;
- reported version: `xcsh/21.37.4`.

The supervised service was healthy after baseline deployment. Its previous unit and development
binary remain available for rollback.

## Candidate gate

Before any GitHub write:

1. Run the frozen install, focused voice/provider/session suites, prompt formatting, Biome and
   TypeScript checks, bundle validation, complete workspace tests, privacy and secret scans, and
   `git diff --check`.
2. Create the validated local Conventional Commit; this is not a GitHub write.
3. Build an immutable Linux x64 artifact whose directory name includes the full commit SHA.
4. Run the sanitized real-path replay and deploy that exact artifact to the supervised service.
5. Verify executable path, SHA-256, version, relay, supervisor, host, and sessions.
6. Obtain 4/4 fresh-session physical iPhone observations using the same app build, selected voice,
   model, and procedure.

The four prompts and expected behaviors are:

| Trial | Prompt | Expected behavior |
| --- | --- | --- |
| 1 | Who are you? | Natural “ex-see-shell.” |
| 2 | Spell xcsh letter by letter. | “ex-see-ess-aitch.” |
| 3 | What do you know about me? | Waiting acknowledgement, then the attached agent's result; no premature denial or ChatGPT identity. |
| 4 | What is my favorite color? | Delegation before a grounded known/unknown answer. |

Any miss requires refinement, rebuild, redeployment, and a fresh four-trial run. Retain only trial
ID, expected behavior, heard behavior, pass/fail, artifact SHA, model, and voice label. Never retain
audio, transcripts, credentials, pairing data, or personal answers.

Observed 4/4 is a successful acceptance sample, not a deterministic guarantee. Its exact two-sided
95% binomial confidence interval is approximately 39.76% to 100%.

## Delivery gate

After candidate acceptance, reopen and rewrite issue #3935, reconcile closed issue #3818, push the
validated commit from Ubuntu, and open one PR with `Closes #3935`. Repair CI until
all required checks pass or are legitimately skipped. Squash-merge only after required review and
green CI.

Follow the automatic release through publication and artifact provenance. Confirm npm and Homebrew
availability, install the published artifact, repeat the same 4/4 iPhone matrix, and deploy only that
verified final binary. Preserve v21.37.4 until final service health is confirmed.
