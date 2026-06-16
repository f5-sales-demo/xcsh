Runs a workflow from the F5 XC console catalog against a live browser session.

<instruction>
- Reads a YAML workflow definition from the catalog directory
- Executes browser automation steps sequentially (navigate, click, fill, assert, etc.)
- Resolves {param} placeholders from the provided params map
- Supports conditional steps, sub-steps, and observable mode with screenshots
- Use this tool when you need to automate F5 XC console operations defined in catalog workflows
</instruction>

<output>
Returns a per-step pass/fail report with timing and optional screenshot paths.
</output>
