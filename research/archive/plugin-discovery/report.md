# Plugin Progressive-Hints Discovery — Results

_Generated 2026-07-22T14:25:26Z. Metric = engine invocation from the tool-call transcript
(a correct answer proves nothing; the deal file already contains 65.6/Yellow)._

_Rates use CONCLUSIVE cells as the denominator: timeout-inconclusive cells
(killed at the wall-clock limit before any plugin contact) are excluded and
reported separately. INVOKED/READ remain valid under timeout._

## 1. Per-condition (trigger prompts only; negative excluded)

| Condition | INVOKED rate | TOUCHED rate (incl. READ) | conclusive n | timeout-inconclusive |
|---|---|---|---|---|
| control | 0% (0/24) | 0% (0/24) | 24 | 6 |
| A | 53% (16/30) | 100% (30/30) | 30 | 0 |
| C | 47% (14/30) | 80% (24/30) | 30 | 0 |
| B | 0% (0/22) | 0% (0/22) | 22 | 8 |

## 2. Condition × artifact (INVOKED rate, triggers, conclusive denom)

| Condition | self-describing | thin |
|---|---|---|
| control | 0% (0/12) | 0% (0/12) |
| A | 60% (9/15) | 47% (7/15) |
| C | 47% (7/15) | 47% (7/15) |
| B | 0% (0/11) | 0% (0/11) |

## 3. Artifact main effect (INVOKED rate, pooled, triggers, conclusive denom)

| Artifact | INVOKED rate |
|---|---|
| self-describing | 30% (16/53) |
| thin | 26% (14/53) |

## 4. Negative control (must be 0 INVOKED)

| Condition | negative INVOKED | negative READ | n |
|---|---|---|---|
| control | 0 | 0 | 6 |
| A | 0 | 0 | 6 |
| C | 0 | 0 | 6 |
| B | 0 | 0 | 6 |

## 5. Per-cell detail (INVOKED/READ/BYPASS out of trials; engine cmds; timeouts)

| Condition | Artifact | Prompt | I / R / B | cmds | timeouts |
|---|---|---|---|---|---|
| control | self-describing | overview | 0 / 0 / 3 | - | 0 |
| control | self-describing | score | 0 / 0 / 3 | - | 0 |
| control | self-describing | next | 0 / 0 / 3 | - | 0 |
| control | self-describing | resume | 0 / 0 / 3 | - | 3 |
| control | self-describing | cold | 0 / 0 / 3 | - | 0 |
| control | self-describing | negative | 0 / 0 / 3 | - | 0 |
| control | thin | overview | 0 / 0 / 3 | - | 0 |
| control | thin | score | 0 / 0 / 3 | - | 0 |
| control | thin | next | 0 / 0 / 3 | - | 0 |
| control | thin | resume | 0 / 0 / 3 | - | 3 |
| control | thin | cold | 0 / 0 / 3 | - | 0 |
| control | thin | negative | 0 / 0 / 3 | - | 0 |
| A | self-describing | overview | 0 / 3 / 0 | - | 0 |
| A | self-describing | score | 3 / 0 / 0 | score | 0 |
| A | self-describing | next | 3 / 0 / 0 | next,next,next | 0 |
| A | self-describing | resume | 1 / 2 / 0 | resume,resume,resume | 3 |
| A | self-describing | cold | 2 / 1 / 0 | cold,cold,cold,cold,cold | 1 |
| A | self-describing | negative | 0 / 0 / 3 | - | 0 |
| A | thin | overview | 1 / 2 / 0 | overview | 0 |
| A | thin | score | 2 / 1 / 0 | score | 0 |
| A | thin | next | 1 / 2 / 0 | next,next,next | 0 |
| A | thin | resume | 2 / 1 / 0 | resume,resume,resume,resume | 3 |
| A | thin | cold | 1 / 2 / 0 | cold,cold,cold,cold | 1 |
| A | thin | negative | 0 / 0 / 3 | - | 0 |
| C | self-describing | overview | 0 / 0 / 3 | - | 0 |
| C | self-describing | score | 2 / 1 / 0 | score,score | 0 |
| C | self-describing | next | 1 / 2 / 0 | next,next,next | 0 |
| C | self-describing | resume | 2 / 1 / 0 | resume,resume,resume | 3 |
| C | self-describing | cold | 2 / 1 / 0 | cold,cold,cold,cold,cold | 3 |
| C | self-describing | negative | 0 / 0 / 3 | - | 0 |
| C | thin | overview | 0 / 0 / 3 | - | 0 |
| C | thin | score | 2 / 1 / 0 | score,score,score | 0 |
| C | thin | next | 2 / 1 / 0 | next,next,next,next,next | 0 |
| C | thin | resume | 1 / 2 / 0 | resume,resume,resume,resume | 3 |
| C | thin | cold | 2 / 1 / 0 | cold,cold,cold,cold,cold | 3 |
| C | thin | negative | 0 / 0 / 3 | - | 0 |
| B | self-describing | overview | 0 / 0 / 3 | - | 0 |
| B | self-describing | score | 0 / 0 / 3 | - | 0 |
| B | self-describing | next | 0 / 0 / 3 | - | 0 |
| B | self-describing | resume | 0 / 0 / 3 | - | 3 |
| B | self-describing | cold | 0 / 0 / 3 | - | 1 |
| B | self-describing | negative | 0 / 0 / 3 | - | 0 |
| B | thin | overview | 0 / 0 / 3 | - | 0 |
| B | thin | score | 0 / 0 / 3 | - | 0 |
| B | thin | next | 0 / 0 / 3 | - | 0 |
| B | thin | resume | 0 / 0 / 3 | - | 3 |
| B | thin | cold | 0 / 0 / 3 | - | 1 |
| B | thin | negative | 0 / 0 / 3 | - | 0 |

## 6. Decision

- **Winner by INVOKED rate on triggers (negative==0): A** at 53% (16/30 conclusive).
- **Artifact main effect:** thin 26% vs self-describing 30% (Δ -4 pts). Thinning has little effect — discovery, not the artifact, dominates.

_Decision rule: highest INVOKED rate on the trigger prompts with zero INVOKED on the negative control; smallest prompt footprint breaks ties (control < B-config < A-index < C-directive)._
