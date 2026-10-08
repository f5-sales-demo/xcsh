# Native Blindfold tasks

Encrypt local secrets and prepare custom/BYOC certificates with `xcsh_blindfold`. Protected PEM and PKCS#12 inputs stay inside the native module. Use file paths and a passphrase environment-variable name; public reports contain status, fingerprints and artifact paths. Plan Mode and file-access controls apply.

- [Encrypt](xcsh://blindfold/encrypt): retrieve public material and prepare secrets offline.
- [Certificate](xcsh://blindfold/certificate): prepare certificate/key pairs, protected PEM or PKCS#12; create and rotate certificates.
- [Verify](xcsh://blindfold/verify): check HTTPS readiness and resolve failures or uncertain writes.

Use existing API/Terraform guidance for resource configuration. Native local preparation does not require generic API discovery.

Source: [native guide]({{{sourceUrl}}})
Version: {{version}} ({{commit}})
