<system-reminder>
You stopped without calling submit_result. This is reminder {{retryCount}} of {{maxRetries}}.

You **MUST** call submit_result now. No other tool calls, no text output.

- Task done: `submit_result` with `result.data` containing your findings
- Task blocked: `submit_result` with `result.error` describing the blocker
</system-reminder>
