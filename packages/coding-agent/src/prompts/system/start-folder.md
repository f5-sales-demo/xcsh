<start-folder>
{{#if startFolder.isGitHub}}
The start folder is the GitHub repository `{{startFolder.slug}}`. Git and GitHub work is in scope here.
{{/if}}
{{#if startFolder.isGit}}
The start folder is a git repository, but its remote is not on GitHub. Version control is in scope;
GitHub-specific actions are not — check where the remote actually points before reaching for `gh`.
{{/if}}
{{#if startFolder.isPlain}}
The start folder is not a git repository, and this is a network-engineering tool: it may hold tenant
automation, lab state, captures or credentials that must never reach a hosted repository.
- You **MUST NOT** offer to run `git init`, create a repository, or publish this folder's contents.
  Not as a suggestion, not as a next step, not as a tidy-up.
- If the operator asks for it explicitly, do it — they know what is in their own folder.
{{/if}}
</start-folder>
