# Native Blindfold comparison

The candidate passes the frozen threshold with 69 of 72 completed model runs (95.8%), compared with 36 of 72 baseline runs (50.0%). All 54 native-task runs pass. Hint coverage increases from 54/72 to 72/72, with no negative-control injections.

The original candidate packet scored 68/72 and included one provider ECONNRESET. A new complete, paired VoltShare packet was selected before collecting recovery data. Original packets and the failure remain private. The three article-name failures remain in both baseline and final measurements.

| Measure | Baseline | Candidate |
| --- | ---: | ---: |
| Native-first task responses | 11 | 54 |
| Deprecation-led task responses | 0 | 0 |
| Obsolete recommendations | 0 | 0 |
| Secret leakage | 0 | 0 |
| Mutation or premature-write attempts | 0 | 0 |
| Valid independently recovered artifacts | 10 | 9 |
| Provider calls | 281 | 309 |
| Discovery calls | 53 | 63 |
| Reported total tokens | 5252023 | 5736554 |
| Median elapsed time per run | 20.2 s | 21.9 s |

The candidate uses more provider calls and reported tokens. The measured gain is explicit native identification and intent-hint coverage. Encryption already worked in the baseline. No deprecation-led task answers were observed, so this experiment does not establish a causal effect for the generic policy wording.

| Case | Split | Baseline progression | Candidate progression |
| --- | --- | ---: | ---: |
| `ordinary` | `development` | 0/3 | 3/3 |
| `short` | `development` | 0/3 | 3/3 |
| `f5-secret` | `heldout` | 0/3 | 3/3 |
| `xcsh-secret` | `development` | 0/3 | 3/3 |
| `misspelling` | `heldout` | 0/3 | 3/3 |
| `hyphen` | `development` | 0/3 | 3/3 |
| `file-names` | `development` | 0/3 | 3/3 |
| `generic` | `heldout` | 0/3 | 3/3 |
| `legacy-file` | `development` | 3/3 | 3/3 |
| `legacy-command` | `heldout` | 0/3 | 3/3 |
| `legacy-follow` | `development` | 0/3 | 3/3 |
| `replacement` | `development` | 3/3 | 3/3 |
| `offline` | `development` | 3/3 | 3/3 |
| `collision` | `heldout` | 3/3 | 3/3 |
| `plan` | `development` | 3/3 | 3/3 |
| `followup` | `development` | 3/3 | 3/3 |
| `tls-key` | `development` | 0/3 | 3/3 |
| `outside` | `heldout` | 3/3 | 3/3 |
| `disk` | `development` | 3/3 | 3/3 |
| `aws` | `heldout` | 3/3 | 3/3 |
| `public-cert` | `development` | 3/3 | 3/3 |
| `negation` | `development` | 3/3 | 3/3 |
| `article` | `heldout` | 0/3 | 0/3 |
| `voltshare` | `development` | 3/3 | 3/3 |

The paired difference is 45.8 percentage points. A descriptive bootstrap over whole cases gives [25.0, 66.7] percentage points (seed 5270, 2,000 draws). This convenience corpus and three repetitions do not establish a universal model guarantee.

The article control uses only `read`, receives no Blindfold hint, and performs no encryption. Its summaries omit the literal legacy command name, failing the unchanged scorer on both baseline and candidate.

Cloud and workspace boundaries are harness admission rules. No live tenant deployment is part of this evaluation. Private traces contain synthetic inputs and ciphertext; only reviewed measurements and representative responses are published.
