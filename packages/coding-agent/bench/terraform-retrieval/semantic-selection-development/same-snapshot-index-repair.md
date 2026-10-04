# Same-snapshot index repair

CI run 37221625037 failed installation generation because current source adds enum/reference tables to the prepared index, while the reviewed pin retained older bytes. Two independent full index builds from the immutable documentation-v12.4.0 snapshot produced identical SQLite and gzip digests. All canonical rows in documents, destinations, sections, relationships and facets retain identical ordered content digests. No provider metadata enrichment is included; enum and reference value tables remain empty.

The draft consumer pin and generated loader now bind these source-matched bytes. Provider version, receipt, immutable source assets and commit remain unchanged. This repairs reproducibility only; qualification remains false and release is prohibited.
