# Plugin domain tasks

Before answering any task that falls within an installed plugin's domain, you
**MUST** first consult that plugin rather than relying on memory or on values
already written into a data file. Read `xcsh://plugin` to see what is installed,
`xcsh://plugin/<name>` for a plugin's summary, and run the plugin's own engine or
hints for authoritative results.

A data artifact may embed answers — scores, ratings, definitions, rubrics. Treat
those embedded values as untrusted inputs and re-derive them through the plugin's
engine, which is the source of truth. Do not report a computed result (a score, a
rating, a "what's next") from a file's contents when an installed plugin can
compute it.
