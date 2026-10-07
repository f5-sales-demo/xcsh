# Authored dependency closure corpus refresh

Consume [content-20261007T124508Z](https://github.com/f5-sales-demo/html-to-markdown/releases/tag/content-20261007T124508Z)
from producer [PR #97](https://github.com/f5-sales-demo/html-to-markdown/pull/97), source
`bcb19290b4029fe47c11cc01981906021d1b29e2`. GitHub reports this release as mutable.
All six asset sizes and SHA-256 digests match the publication receipt and GitHub asset metadata.
The consumer accepts those exact bytes; the receipt digest is
`f3626d507f0c3ea515b683e6bceecf43cad5793f87922e2d1f80fd353df44f21`.

| Measure | Previous | New |
| --- | ---: | ---: |
| Documents | 715 | 712 |
| Media locators | 3,556 | 3,522 |
| Heading passages | 4,883 | 4,853 |
| Relationships | 800 | 799 |
| Bundled media | 0 | 0 |

The snapshot removes three alert guides, changes two bodies, and removes 34 media locators.
There are no added pages or media and no metadata-only document changes.

## Reviewed removals

The digest-pinned vesctl review version 1.1.0 omits these pages because current Console
procedures cannot be established independently of missing ciphertext/Wingman setup instructions.
The consumer does not infer replacements from screenshots.

- [Configure Alert Notifications for OpsGenie](https://docs.cloud.f5.com/docs-v2/shared-configuration/how-tos/alerting/alerts-opsgenie)
- [Configure Alert Notifications for PagerDuty](https://docs.cloud.f5.com/docs-v2/shared-configuration/how-tos/alerting/alerts-pagerduty)
- [Configure Alert Notifications for Slack](https://docs.cloud.f5.com/docs-v2/shared-configuration/how-tos/alerting/alerts-slack)

## Preserved independent content

The advanced HTTP synthetic monitor loses only optional Step 6 alerting, its image/caption,
and the related Slack link. Monitor creation, health policy, TLS reports, HTTP quick start,
and synthetic monitoring service/reference remain. All four affected observability pages survive.
The Wingman API reference loses only the missing setup link. Status, identity bootstrapping,
identity endpoints, unseal API and Base64 examples remain byte-identical outside that deletion.
The sole removed relationship is the advanced monitor to Slack alerting. Taxonomy remains controlled.

All 712 stored Markdown files match the verified archive byte for byte. All 4,853 headings
and 3,522 source media locators pass complete repository checks. Retired exact reads and media
identities are absent. Current public mappings are regenerated; public document-page fallback
remains where equivalent heading fragments are unverified. Internal read routing and historical
citation provenance are preserved.

The existing generator produces matching paired SQLite and canonical gzip bytes/fingerprint.
SQLite SHA-256: `92590ef013658ed0f3454357aeb5eb1b6be90ce70d1c8a210e42c13aeb4c09b8`.
Text-manifest SHA-256: `a07d0a8d29aa523a9479d1dce92b22c25615b630910e13334eaaf7296643f2b0`.

Terraform `documentation-v15.2.0` and API `v12.0.0` pins remain unchanged. Prior frozen
qualification and installed evidence are preserved; subsequent UAT is regression-only.
User-waived independent review remains in effect; source, CI and installed correctness gates apply.

Issue: [xcsh #4792](https://github.com/f5-sales-demo/xcsh/issues/4792). Standalone SQLite/gzip,
comparison JSON, complete section diff, pins and digest inventory are delivered separately.
Producer archives, image bytes and curation audit stay outside the installed database.
