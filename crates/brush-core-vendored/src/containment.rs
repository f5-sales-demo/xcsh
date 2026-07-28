//! The containment fence: which paths the shell may reach.
//!
//! The host's text-level boundary decides from the *command string*, which is why it has leaked
//! repeatedly — every spelling of a path is a new hole. This fence is consulted where the shell
//! actually acts, after expansion, alias resolution and symlink following, so how the path was
//! written cannot matter.
//!
//! It is deliberately permissive. Anything matched by no root is outside the fence and allowed, so
//! `/usr`, `/tmp`, package caches, the network and process execution are untouched. The single thing
//! it prevents is reaching into another customer's checkout or the operator's private files.
//!
//! The fence is per-invocation and absent by default: only the model's `bash` tool supplies one.
//! Host-driven shell use — credential helpers, the interactive `xcsh shell`, snapshot sourcing —
//! runs with no fence and is unaffected.

use std::path::{Component, Path, PathBuf};

/// Direction of access being checked against the fence.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FenceAccess {
	/// Reading a path.
	Read,
	/// Writing or creating a path.
	Write,
}

/// Canonical roots describing what the shell may reach.
#[derive(Clone, Debug, Default)]
pub struct ContainmentFence {
	/// Roots the shell may read and write.
	pub allow: Vec<PathBuf>,
	/// Roots the shell may read but not write.
	pub allow_read_only: Vec<PathBuf>,
	/// Roots denied in both directions, winning over any allow they sit inside.
	pub deny: Vec<PathBuf>,
}

/// How specific a matching root is. Deeper wins, so a nested rule beats the root it sits inside.
fn depth(root: &Path) -> usize {
	root.components().filter(|c| matches!(c, Component::Normal(_))).count()
}

/// The deepest root in `roots` that contains `candidate`, with its depth.
fn deepest_match(roots: &[PathBuf], candidate: &Path) -> Option<usize> {
	let mut best: Option<usize> = None;
	for root in roots {
		if !candidate.starts_with(root) {
			continue;
		}
		let d = depth(root);
		if best.is_none_or(|current| d > current) {
			best = Some(d);
		}
	}
	best
}

/// Resolve symlinks so the fence sees the file the shell will really touch.
///
/// A path that does not exist yet cannot be canonicalised — and a write target usually does not, so
/// this must not fail on it. The deepest existing ancestor is resolved instead and the missing tail
/// re-appended, which is what keeps a not-yet-created file under a symlinked directory on the correct
/// side of the fence. Without it, `/tmp/x` and `/private/tmp/x` land on opposite sides and a rule that
/// looks like it enforces does not.
fn canonicalize_for_fence(candidate: &Path) -> PathBuf {
	if let Ok(resolved) = candidate.canonicalize() {
		return resolved;
	}
	let mut ancestor = candidate;
	while let Some(parent) = ancestor.parent() {
		if let Ok(real_parent) = parent.canonicalize() {
			return match candidate.strip_prefix(parent) {
				Ok(tail) => real_parent.join(tail),
				Err(_) => candidate.to_path_buf(),
			};
		}
		ancestor = parent;
	}
	candidate.to_path_buf()
}

impl ContainmentFence {
	/// Whether `candidate` may be accessed for `access`.
	///
	/// Deepest match wins and a deny beats an allow at equal depth, matching the host policy's
	/// precedence so the two layers cannot disagree about a path they both see. The default differs
	/// and is the point: a path matched by nothing is outside the fence, so it is allowed.
	#[must_use]
	pub fn permits(&self, candidate: &Path, access: FenceAccess) -> bool {
		if self.allow.is_empty() && self.allow_read_only.is_empty() && self.deny.is_empty() {
			return true;
		}
		let resolved = canonicalize_for_fence(candidate);

		let denied = deepest_match(&self.deny, &resolved);
		let read_only = deepest_match(&self.allow_read_only, &resolved);
		let allowed = deepest_match(&self.allow, &resolved);

		let deepest = denied.max(read_only).max(allowed);
		let Some(deepest) = deepest else {
			return true;
		};

		// Deny first at equal depth: the cross-session leak roots rely on it, since they sit under
		// roots that are otherwise allowed.
		if denied == Some(deepest) {
			return false;
		}
		if read_only == Some(deepest) {
			return access == FenceAccess::Read;
		}
		true
	}
}

// No `#[cfg(test)]` block here on purpose. This crate is `exclude`d from the workspace
// (root Cargo.toml) and reached only through `[patch.crates-io]`, so `cargo test -p brush-core`
// refuses to run — "requires dev-dependencies and is not a member of the workspace". Unit tests
// added here would look like coverage and never execute.
//
// Instead `permits` is exercised from TypeScript through the `fencePermits` napi export, by a
// conformance test that runs one corpus through BOTH this implementation and the TS
// `fenceVerdict` and asserts they agree. That is the risk worth testing: two languages evaluating
// one rule set, free to drift.
