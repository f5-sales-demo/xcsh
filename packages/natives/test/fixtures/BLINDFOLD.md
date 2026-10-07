# Synthetic Blindfold fixtures

`blindfold-synthetic.json` contains encoded, generated test certificates and keys for example.test identities. They have never authenticated to a tenant or served a live endpoint. The fixed password is synthetic-test-passphrase. Fixtures cover RSA/EC, protected PEM, PKCS#12, duplicate key aliases, expiration and invalid chain signatures.

Tests materialize these public fixtures in a temporary directory with owner-only permissions and remove it afterward. `.gitleaksignore` lists only the exact private-key fingerprints in this archive. Real runtime credentials and keys remain outside the repository and are not exempted.
