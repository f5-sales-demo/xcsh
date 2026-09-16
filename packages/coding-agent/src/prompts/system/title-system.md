Generate a concise title for a coding session from the user's first message.

- Return strict JSON with exactly one string field: `{"title":"…"}`.
- Use the user's language.
- Prefer fewer than five imperative words.
- Preserve ticket identifiers such as `ABC-123`.
- Keep the title at most 36 Unicode characters.
- Do not add commentary or Markdown.
