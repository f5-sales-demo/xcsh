<realtime_delegation>
{{#if tail}}
  <source>transcript_tail_flush</source>
{{/if}}
  <input>{{{input}}}</input>
{{#if transcript}}
  <transcript_delta>{{{transcript}}}</transcript_delta>
{{/if}}
</realtime_delegation>
