Runs a workflow from the F5 XC console catalog against a live browser session.

<instruction>
- The console workflow catalogue is embedded in xcsh; `catalog_path` is optional and only needed to override with a local checkout
- Executes browser automation steps sequentially (navigate, click, fill, assert, etc.) against the browser attached via `browser.connectUrl` (co-drive headed) or a background target (autonomous + screenshots)
- Resolves {param} placeholders from the provided params map
- Supports conditional steps, sub-steps, and observable mode with screenshots
- Use this tool when you need to automate F5 XC console operations defined in catalog workflows
</instruction>

<output>
Returns a per-step pass/fail report with timing and optional screenshot paths.
</output>
