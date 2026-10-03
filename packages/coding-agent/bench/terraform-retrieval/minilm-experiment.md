# Offline MiniLM development experiment

This harness measures candidate embedding and reciprocal rank fusion. It is not
production retrieval, complete response latency, confidence calibration, or
held-out qualification. Existing qualification suites are rejected. No model
dependency is added to xcsh.

Use an isolated Python environment with the versions recorded in
`minilm-development-preparation.json`. Acquire the model at the recorded immutable
revision separately. Both commands load only local model files and verify every
file hash; they do not download weights.

Generate canonical destination JSON with `export_terraform_destinations.py`,
providing `--index`, `--pin`, and a fresh `--output` path. The command verifies
the reviewed index SHA-256 before reading its exact property destinations.
Generate lexical inputs with `semantic-candidate-input.ts`, supplying the same
development suite and reviewed SQLite index. Keep all input bytes and receipts.

```sh
python build_minilm_vectors.py \
  --corpus /absolute/destinations.json \
  --preparation minilm-development-preparation.json \
  --model /absolute/model \
  --output /absolute/new-vectors.npy \
  --receipt /absolute/new-vector-receipt.json

python minilm_experiment.py \
  --corpus /absolute/destinations.json \
  --preparation minilm-development-preparation.json \
  --model /absolute/model \
  --vectors /absolute/new-vectors.npy \
  --receipt /absolute/new-vector-receipt.json \
  --lexical /absolute/development-lexical.json \
  --suite /absolute/development-suite.json \
  --output /absolute/development-report.json
```

The builder refuses to replace artifacts and rejects token truncation. Its input
format is description, provider role, provider name, and schema path, with plain
spaces replacing separators. This differs from the earlier task-local vectors;
retain separate vector hashes when comparing them.

The evaluator checks suite labels against lexical input bytes and rejects missing
schema destinations. It lists guidance destinations outside the property corpus
and retains those cases in the reported answerable denominator. Five repetitions
must produce identical destinations and scores. Scores are ranking values.
`--property-only` removes lexical navigation destinations before fusion; use it
only as an explicitly reported development comparison.

Run model-independent checks with:

```sh
python -m unittest test_minilm_experiment test_hybrid_ranking
```

The original task-local MiniLM results and reproduced ranking evidence are kept
in `minilm-hybrid-original-development-receipt.json` and
`minilm-reproducibility-receipt.json`. Neither qualifies release. The consumer
remains draft until a new independently reviewed frozen benchmark and installed
acceptance meet the agreed gates.
