# Plugin presentation

Tools can provide an optional data-only `presentation` descriptor. xcsh renders it with the active
theme and terminal width. Plugins need no runtime imports from xcsh or its renderer packages.

```typescript
import type { PluginPresentation } from "@f5-sales-demo/xcsh";

const presentation: PluginPresentation<unknown, { total: number }> = {
  result: result => ({
    summary: `total = ${result.total}`,
    sections: [{ kind: "fields", values: { total: result.total } }],
  }),
};
```

Attach the descriptor to the object passed to `registerTool`. Its optional `call(args, options)`
and `result(result, options, args)` callbacks return a `PluginView`. Options include `expanded`
and `isPartial`. A view contains a summary, warnings, and sections:

- `fields`: a labeled `values` record.
- `table`: `columns` with a key, optional label and alignment, plus `rows` of records.
- `markdown`: Markdown text, rendered by xcsh.
- `code`: literal text and an optional language.

Explicit component renderers take precedence, followed by the descriptor and the themed fallback.
An absent, empty or failed renderer retains readable output. Callbacks receive copied data;
presentation does not change execution, model-facing content or stored results.

Collapsed tables show three complete data rows and the remaining-row count. Supply totals, scope
and warnings in the summary or fields so they remain visible. Expanded views retain every source
result and detail field. Tables wrap cells or reflow wide records into labeled fields as the
terminal narrows. Errors retain their complete guidance, and theme changes use the same data.

## Reusable helpers

Every extension receives the same frozen `pi.presentation` API. It returns data descriptors,
never renderer components, and requires no runtime imports in plugins:

```typescript
const tool = pi.presentation.withPresentation(definition, {
  command: "example-cli",
  scopeKeys: ["project", "region", "limit"],
  collections: ["instances", "items"],
  labels: { id: "Instance ID", status: "Status" },
  scopeNote: "Counts cover returned records in the selected scope.",
});
pi.registerTool(tool);
```

Profiles reuse the runtime's nested data conversion, returned collection counts, scope display,
labels, completeness warnings, and safe fallback. Supply a callback descriptor for domain-specific
aggregates, schema filtering, or currency separation. A missing, failed, or empty callback retains
execution evidence. Summary-only callbacks retain default data sections.

`fields(values, title)`, `table(rows, columns, title)`, and `data(value, title)` handle structured
values. Ordered table columns accept labels, alignment, and optional `Intl.NumberFormatOptions`
in `numberFormat`; formatting changes display copies only. Monetary units must remain explicit.
`command(argv, title)` displays shell-quoted arguments without executing them. Lifecycle setup
reviews use this same helper and retain timeouts and verification commands.

Custom messages may provide a UI-only `presentation` view built with these helpers. It survives
session reconstruction and remains separate from model-facing `content`. Unavailable integration
state is evidence of unavailability, not a verified zero. Streaming and explicitly partial data
retain warnings in collapsed and expanded views. Content-only plugins and advisory messages use
the same themed Markdown and lifecycle primitives without needing a tool adapter.
