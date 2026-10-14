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
