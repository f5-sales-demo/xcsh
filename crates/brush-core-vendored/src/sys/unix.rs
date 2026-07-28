pub mod commands;
pub mod fd;
pub mod fs;
pub mod input;
/// Landlock is Linux-only; other unix platforms have no OS backend for containment.
#[cfg(target_os = "linux")]
pub mod landlock;
pub(crate) mod network;
use crate::error;
pub use crate::sys::tokio_process as process;
pub mod resource;
pub mod signal;
pub mod terminal;
pub(crate) mod users;

/// Platform-specific errors.
#[derive(Debug, thiserror::Error)]
pub enum PlatformError {
	/// A system error occurred.
	#[error("system error: {0}")]
	ErrnoError(#[from] nix::errno::Errno),
}

impl From<nix::errno::Errno> for error::ErrorKind {
	fn from(err: nix::errno::Errno) -> Self {
		PlatformError::ErrnoError(err).into()
	}
}
