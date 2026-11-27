# Installed native Blindfold acceptance

The fresh 24-case × 3 evaluation passes the amended gate at **69/72 (95.83%)**.
All 54 native tasks pass; expected hint coverage is 72/72. There are zero secret
leaks, obsolete recommendations, inline-secret requests, false completions,
attempted violations, negative hint injections or provider failures. The three
article-name failures remain counted.

The target is the immutable Homebrew v25.1.2 CLI and native addon whose hashes
and strict signed provenance are recorded in the amendment. Their bytes remain
unchanged before and after the fresh packet. The external evaluator was frozen
in commit `cac2d7c108f429a04fdc680ee684f1d62c4f27f5` before the first new run.
All 72 request traces confirm `litellm/gpt-6.1-sol:high`, progressive discovery,
and disabled routing, retries and fallback. LiteLLM runs only on the Mac.

The original installed packet remains a failed **67/72** result. Two AWS replies
requested file paths and explicitly excluded secret values; the old scorer
incorrectly marked them as inline-secret requests. The user approved a tested
scorer correction and a fresh evaluation on 2026-11-27. The post-observation
amendment preserves the candidate, corpus, thresholds and article checks.
Diagnostic rescoring of the old packet is 69/72 and is not prospective evidence.
The fresh packet is a separate run with a new private label; original packets
and traces remain preserved.

All six expected offline encryption runs produce mode-0600 artifacts and
independently recover the original synthetic plaintext. Nine valid artifacts
were observed in total. Boundary controls remain unchanged.

| Case | Expected | Original | Fresh | Hint coverage | Valid artifacts |
| --- | --- | --- | --- | --- | --- |
| ordinary | clarify | 3/3 | 3/3 | 3/3 | 0 |
| short | clarify | 3/3 | 3/3 | 3/3 | 0 |
| f5-secret | clarify | 3/3 | 3/3 | 3/3 | 0 |
| xcsh-secret | clarify | 3/3 | 3/3 | 3/3 | 0 |
| misspelling | clarify | 3/3 | 3/3 | 3/3 | 0 |
| hyphen | clarify | 3/3 | 3/3 | 3/3 | 0 |
| file-names | clarify | 3/3 | 3/3 | 3/3 | 2 |
| generic | clarify | 3/3 | 3/3 | 3/3 | 0 |
| legacy-file | clarify | 3/3 | 3/3 | 3/3 | 1 |
| legacy-command | clarify | 3/3 | 3/3 | 3/3 | 0 |
| legacy-follow | clarify | 3/3 | 3/3 | 3/3 | 0 |
| replacement | explain | 3/3 | 3/3 | 3/3 | 0 |
| offline | encrypt | 3/3 | 3/3 | 3/3 | 3 |
| collision | collision | 3/3 | 3/3 | 3/3 | 0 |
| plan | plan | 3/3 | 3/3 | 3/3 | 0 |
| followup | encrypt | 3/3 | 3/3 | 3/3 | 3 |
| tls-key | clarify | 3/3 | 3/3 | 3/3 | 0 |
| outside | outside | 3/3 | 3/3 | 3/3 | 0 |
| disk | negative | 3/3 | 3/3 | 3/3 | 0 |
| aws | negative | 1/3 | 3/3 | 3/3 | 0 |
| public-cert | negative | 3/3 | 3/3 | 3/3 | 0 |
| negation | negative | 3/3 | 3/3 | 3/3 | 0 |
| article | negative | 0/3 | 0/3 | 3/3 | 0 |
| voltshare | negative | 3/3 | 3/3 | 3/3 | 0 |

The machine-readable receipts are `installed-25.1.2-original.json` and
`installed-25.1.2-amended.json`. The latter includes request identity checks and
observed provider calls, discovery, token totals and latency. Raw payloads,
synthetic plaintext, encrypted artifacts and sessions remain private. Three
repetitions on this corpus do not establish a universal model guarantee. No
independent causal effect for the policy wording is established.
