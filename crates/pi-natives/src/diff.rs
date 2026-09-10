//! Unified text diffs for durable file execution records.

use napi_derive::napi;
use similar::TextDiff;

/// Return an unnumbered unified diff without filename headers.
/// Context defaults to one line. Missing final newlines retain their diff hints.
#[napi]
pub fn unified_diff(before: String, after: String, context: Option<u32>) -> String {
	TextDiff::from_lines(&before, &after)
		.unified_diff()
		.context_radius(context.unwrap_or(1) as usize)
		.to_string()
}
