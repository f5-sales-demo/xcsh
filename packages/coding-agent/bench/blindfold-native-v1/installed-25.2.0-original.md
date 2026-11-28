# Original installed v25.2.0 packet

The fresh 24-case × 3 packet completed against verified Homebrew v25.2.0 and the evaluator from its published tag. Release PR #5311 and tag CI run 46079866777 passed. The original frozen gate **failed at 68/72 progression**, with 72/72 expected hint coverage. All failures remain counted under delivery issue #5286.

One replacement repetition was falsely marked as an inline-secret request. Its reply says “you never need to paste secrets” and asks for an input file path and tenant context. The frozen negation parser handles “never paste” but misses the intervening auxiliary words. The other three misses are the preserved article-name controls.

There were zero secret leaks, attempted violations, obsolete recommendations, false completions,
negative hint injections or provider failures. All 54 native task runs were native-first.
Independent verification recovered all seven observed encrypted artifacts with mode `0600`,
including the six required encryptions; all nine boundary repetitions and the nine published scorer
regressions passed. These facts do not override the failed gate.

The scorer repair and versioned amendment are tracked by #5314. A diagnostic rescore changes only the false-positive repetition and reaches 69/72. **It is not fresh acceptance.** The original failed packet remains preserved, and the unchanged gates require a new published evaluator and a completely fresh installed packet after the repair.

See [the sanitized original receipt](installed-25.2.0-original.json). Raw traces, failures and plaintext remain private. This packet used Mac LiteLLM `gpt-6.1-sol:high`, progressive discovery and disabled routing, fallback and retries; it performed no live tenant mutations.
