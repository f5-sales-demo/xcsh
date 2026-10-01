<critical>
Plan approved. You **MUST** execute it now.
</critical>

Finalized plan artifact: `{{finalPlanFilePath}}`

## Plan

{{planContent}}

<instruction>
You **MUST** execute this plan step by step from `{{finalPlanFilePath}}`. You have full tool access.
You **MUST** verify each step before proceeding to the next.
{{#has tools "todo_write"}}
Use `todo_write` when progress tracking helps execute substantial work or the user requests it. Update tracking when task state materially changes.
{{/has}}
</instruction>

<critical>
You **MUST** keep going until complete. This matters.
</critical>
