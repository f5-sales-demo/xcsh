# Idempotent Blindfold ensure

`xcsh blindfold ensure --name NAME -n NAMESPACE --cert chain.pem --key key.pem` creates or rotates a
named certificate, or returns `unchanged` without a write when public material, context, and remote
provenance match. `--bundle FILE` and `--passphrase-env NAME` use native protected inputs.
`--dry-run client` validates inputs and reads context without encrypting or mutating tenant resources.
Raw `encrypt`, `certificate`, `create`, `replace`, compatibility output and saved manifests remain.

`xcsh blindfold ensure -f resource.yaml` removes a version 1 `x-xcsh-blindfold` extension before sending
the manifest. The extension has a `certificates` array with unique `id`, a recognized certificate-node
JSON `pointer`, `certificate_file`/`private_key_file` or `pkcs12_file`, optional `passphrase_env` and
`policy`. File paths resolve relative to the manifest. The shared assistant service accepts paths
and environment names only, and returns no plaintext or encrypted payloads.

The reserved provenance annotation contains public chain/SPKI identity, context digest, ciphertext
hash and algorithm. It is reconciliation metadata, not attestation. Missing or inconsistent metadata
requires regeneration. RSA/EC cutover requires a new certificate/reference. A write is attempted
once and reconciled by named complete-form readback. Concurrent tool ownership is unsupported.

The embedded immutable contract is pinned under `src/services/blindfold-contract` in the coding-agent
package. Qualification receipts distinguish source tests from installed and live acceptance.
