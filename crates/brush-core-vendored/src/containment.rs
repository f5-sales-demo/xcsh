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

/// The identity of a filesystem object, independent of the path used to reach it.
///
/// Resolving a path before opening it removes the final component from the race, but `open` still
/// walks the directories above it, so a renamed directory can redirect a path that was just cleared.
/// Comparing what was cleared against what was actually opened is what closes that: paths can be made
/// to point somewhere else, an inode cannot.
///
/// Measured on the attack this exists for — a background process renaming a workspace directory aside
/// and symlinking a sibling checkout in its place leaked through a redirect 17 times in 1000 attempts
/// before this check, and 0 after.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FileIdentity {
	device: u64,
	inode:  u64,
}

impl FileIdentity {
	/// The identity of the object at `path`, or `None` if it cannot be inspected.
	///
	/// `None` is not a failure: the common case is a path that does not exist yet because it is about
	/// to be created. The caller distinguishes the two, and must not read `None` as "unchanged".
	#[must_use]
	pub fn of_path(path: &Path) -> Option<Self> {
		std::fs::metadata(path).ok().as_ref().map(Self::from_metadata)
	}

	/// The identity of the object an open handle refers to.
	///
	/// Taken from the descriptor rather than from a path, which is the whole point: it cannot be
	/// redirected after the fact.
	#[must_use]
	pub fn of_handle(file: &std::fs::File) -> Option<Self> {
		file.metadata().ok().as_ref().map(Self::from_metadata)
	}

	#[cfg(unix)]
	fn from_metadata(metadata: &std::fs::Metadata) -> Self {
		use std::os::unix::fs::MetadataExt;
		Self { device: metadata.dev(), inode: metadata.ino() }
	}

	// Windows has no OS backend for containment at all, so this exists to keep the crate building
	// rather than to enforce anything. `volume_serial_number`/`file_index` are only populated for
	// handles opened with the right access, so `0` is the honest answer for a path — and two `0`s
	// comparing equal is the permissive direction, consistent with a platform that does not confine.
	#[cfg(not(unix))]
	fn from_metadata(metadata: &std::fs::Metadata) -> Self {
		use std::os::windows::fs::MetadataExt;
		Self {
			device: metadata.volume_serial_number().unwrap_or(0).into(),
			inode:  metadata.file_index().unwrap_or(0),
		}
	}
}

/// The path an open descriptor actually refers to, asked of the kernel.
///
/// This exists because re-walking a path cannot answer the question. Resolving before opening takes
/// the final component out of the race, and comparing inodes catches a swap that lands between the
/// stat and the open — but a swap that lands *before both* makes the stat and the open agree with each
/// other and disagree with the fence. Measured: with only those two defences, a directory-swap race
/// still leaked 23 times in 600 attempts through an in-process redirect.
///
/// A descriptor is already bound to its inode, so what the kernel reports for it cannot be redirected
/// afterwards. `None` means the platform cannot be asked, which is why the caller keeps a fallback
/// rather than treating absence as permission.
#[must_use]
pub fn path_of_handle(file: &std::fs::File) -> Option<PathBuf> {
	#[cfg(target_os = "linux")]
	{
		use std::os::fd::AsRawFd;
		std::fs::read_link(format!("/proc/self/fd/{}", file.as_raw_fd())).ok()
	}
	#[cfg(target_vendor = "apple")]
	{
		let mut buffer = PathBuf::new();
		nix::fcntl::fcntl(file, nix::fcntl::FcntlArg::F_GETPATH(&mut buffer)).ok()?;
		Some(buffer)
	}
	#[cfg(not(any(target_os = "linux", target_vendor = "apple")))]
	{
		let _ = file;
		None
	}
}

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
	/// Roots the shell may write but not read.
	pub allow_write_only: Vec<PathBuf>,
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
/// Public because a caller that is about to *open* the path must open this resolved form rather than
/// what it was handed. Checking one path and opening another is a race, and a won race is a leak —
/// see [`ContainmentFence::permits_resolved`].
///
/// A path that does not exist yet cannot be canonicalised — and a write target usually does not, so
/// this must not fail on it. The deepest existing ancestor is resolved instead and the missing tail
/// re-appended, which is what keeps a not-yet-created file under a symlinked directory on the correct
/// side of the fence. Without it, `/tmp/x` and `/private/tmp/x` land on opposite sides and a rule that
/// looks like it enforces does not.
pub fn canonicalize_for_fence(candidate: &Path) -> PathBuf {
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
		self.permits_resolved(&canonicalize_for_fence(candidate), access)
	}

	/// Whether an **already resolved** path may be accessed for `access`.
	///
	/// Separate from [`Self::permits`] so a caller that is about to open the path can resolve once,
	/// check that resolved path, and then open *that same* path. `permits` on its own invites the
	/// caller to check one path and open another, and the gap between the two is a race an in-process
	/// shell loses: brush-core runs inside the agent, so its redirections are not covered by the OS
	/// confinement that protects spawned children.
	///
	/// Measured, before the callers were changed: a background process flipping a workspace symlink
	/// between an in-fence file and a sibling checkout's secret leaked that secret through
	/// `cat < pivot` once in 250 attempts, while the other 163 refusals looked like the fence working.
	/// A boundary that holds 99% of the time is not a boundary.
	#[must_use]
	pub fn permits_resolved(&self, resolved: &Path, access: FenceAccess) -> bool {
		if self.allow.is_empty()
			&& self.allow_read_only.is_empty()
			&& self.allow_write_only.is_empty()
			&& self.deny.is_empty()
		{
			return true;
		}

		let denied = deepest_match(&self.deny, resolved);
		let read_only = deepest_match(&self.allow_read_only, resolved);
		let write_only = deepest_match(&self.allow_write_only, resolved);
		let allowed = deepest_match(&self.allow, resolved);

		let deepest = denied.max(read_only).max(write_only).max(allowed);
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
		if write_only == Some(deepest) {
			return access == FenceAccess::Write;
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

/// Escape a path for inclusion in a seatbelt profile string literal.
///
/// Paths may contain any byte except `/` and NUL, so a directory name can hold a quote, a backslash
/// or a **newline** — and a shell can create one, so this is reachable rather than theoretical.
///
/// Escaping the quote is what makes injection impossible: without it, a directory named
/// `x"))\n(allow default)\n(allow file-read* (subpath "/` closes the literal and appends its own
/// rules. Verified against `sandbox-exec`: unescaped, that path grants `(allow default)` and reads a
/// file the profile denied; with the quote escaped the profile no longer parses and the command is
/// refused instead — fail-closed, but refused.
///
/// Escaping the newline is what stops that fail-closed case being an outage. A raw newline breaks the
/// profile, so one oddly-named directory anywhere in the workspace path would make every fenced
/// command fail with "Operation not permitted" and no usable explanation. SBPL accepts `\n` in a
/// string literal — verified — so the escape both parses and keeps the rule meaningful.
fn escape_for_profile(path: &Path) -> String {
	path.to_string_lossy()
		.replace('\\', "\\\\")
		.replace('"', "\\\"")
		.replace('\n', "\\n")
		.replace('\r', "\\r")
}

impl ContainmentFence {
	/// Compile the fence to a seatbelt (macOS sandbox) profile.
	///
	/// `(allow default)` is deliberate and load-bearing. A `(deny default)` profile cannot even
	/// `execvp` a binary without a substantial allowlist — measured: "Operation not permitted" with
	/// only the workspace granted — and everything it would then have to re-permit (exec, dyld, mach
	/// lookups, network) is something this fence does not care about. Starting from allow keeps the
	/// profile small enough to read and cannot break an operation nobody fenced.
	///
	/// **Rules are emitted shallowest-first, and that is the whole correctness argument.** Seatbelt
	/// takes the *last matching* rule and has no notion of specificity, while this fence means
	/// "deepest root wins". Emitting by category instead of by depth silently breaks both directions:
	/// denies-then-allows re-exposes a cross-session root nested inside the workspace, and
	/// allows-then-denies locks the operator out of a workspace nested inside their home. Sorting by
	/// depth reproduces the intended precedence exactly, with deny last at equal depth so it wins.
	///
	/// Every root must already be canonical. A `(subpath "/tmp/x")` rule silently matches nothing when
	/// the real path is `/private/tmp/x` — a rule that appears to enforce and does not — which is why
	/// `buildContainmentFence` resolves them and refuses to build on an unresolvable workspace.
	#[must_use]
	pub fn to_seatbelt_profile(&self) -> String {
		enum Rule<'a> {
			/// Existence and stat only, never contents or a directory listing.
			Metadata(&'a PathBuf),
			Deny(&'a PathBuf),
			Allow(&'a PathBuf),
			ReadOnly(&'a PathBuf),
			WriteOnly(&'a PathBuf),
		}

		let mut rules: Vec<Rule<'_>> = Vec::new();
		rules.extend(self.deny.iter().map(Rule::Deny));
		rules.extend(self.deny.iter().map(Rule::Metadata));
		rules.extend(self.allow.iter().map(Rule::Allow));
		rules.extend(self.allow_read_only.iter().map(Rule::ReadOnly));
		rules.extend(self.allow_write_only.iter().map(Rule::WriteOnly));

		// Shallowest first so a deeper rule overrides it; deny last within a depth so it wins a tie.
		rules.sort_by_key(|rule| match rule {
			Rule::Allow(root) => (depth(root), 0),
			Rule::ReadOnly(root) => (depth(root), 1),
			Rule::WriteOnly(root) => (depth(root), 1),
			Rule::Deny(root) => (depth(root), 2),
			// After the deny at the same depth, so it re-permits stat and nothing else.
			Rule::Metadata(root) => (depth(root), 3),
		});

		let mut profile = String::from("(version 1)\n(allow default)\n");
		for rule in rules {
			match rule {
				Rule::Deny(root) => profile.push_str(&format!(
					"(deny file-read* file-write* (subpath \"{}\"))\n",
					escape_for_profile(root)
				)),
				// Tools walk upward: `git init` stats every ancestor looking for a repository and an
				// ownership marker, and refuses with "fatal: Invalid path" if it cannot. Verified that
				// re-permitting metadata makes git work while contents AND directory listings stay
				// denied — so a sibling's name is still not discoverable, only that the parent exists.
				Rule::Metadata(root) => profile.push_str(&format!(
					"(allow file-read-metadata (subpath \"{}\"))\n",
					escape_for_profile(root)
				)),
				Rule::Allow(root) => profile.push_str(&format!(
					"(allow file-read* file-write* (subpath \"{}\"))\n",
					escape_for_profile(root)
				)),
				Rule::ReadOnly(root) => profile.push_str(&format!(
					"(allow file-read* (subpath \"{}\"))\n(deny file-write* (subpath \"{}\"))\n",
					escape_for_profile(root),
					escape_for_profile(root)
				)),
				Rule::WriteOnly(root) => profile.push_str(&format!(
					"(allow file-write* (subpath \"{}\"))\n(deny file-read* (subpath \"{}\"))\n",
					escape_for_profile(root),
					escape_for_profile(root)
				)),
			}
		}
		profile
	}

}
