//! Atomic filesystem publication without replacing an existing destination.

use std::io;

use napi::{Error, Result};
use napi_derive::napi;

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn rename_without_replacement(source: &str, destination: &str) -> io::Result<()> {
	use std::ffi::CString;

	let source = CString::new(source)
		.map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "Source contains NUL"))?;
	let destination = CString::new(destination)
		.map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "Destination contains NUL"))?;
	// SAFETY: Both pointers name live NUL-terminated C strings. The OS copies
	// their contents; exclusive flags forbid replacement and there is no fallback.
	#[cfg(target_os = "linux")]
	let result = unsafe {
		libc::renameat2(
			libc::AT_FDCWD,
			source.as_ptr(),
			libc::AT_FDCWD,
			destination.as_ptr(),
			libc::RENAME_NOREPLACE,
		)
	};
	// SAFETY: The same live C-string ownership applies to the macOS call.
	#[cfg(target_os = "macos")]
	let result = unsafe { libc::renamex_np(source.as_ptr(), destination.as_ptr(), libc::RENAME_EXCL) };
	if result == 0 {
		Ok(())
	} else {
		Err(io::Error::last_os_error())
	}
}

#[cfg(target_os = "windows")]
fn rename_without_replacement(source: &str, destination: &str) -> io::Result<()> {
	use windows_sys::Win32::Storage::FileSystem::MoveFileExW;

	if source.contains('\0') || destination.contains('\0') {
		return Err(io::Error::new(io::ErrorKind::InvalidInput, "Path contains NUL"));
	}
	let source: Vec<u16> = source.encode_utf16().chain(std::iter::once(0)).collect();
	let destination: Vec<u16> = destination
		.encode_utf16()
		.chain(std::iter::once(0))
		.collect();
	// SAFETY: Both vectors remain live and NUL-terminated for the call. Zero
	// flags forbid replacement, cross-volume copy and deferred reboot operations.
	if unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), 0) } != 0 {
		Ok(())
	} else {
		Err(io::Error::last_os_error())
	}
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn rename_without_replacement(_source: &str, _destination: &str) -> io::Result<()> {
	Err(io::Error::new(io::ErrorKind::Unsupported, "Exclusive rename is unavailable"))
}

/// Publish one prepared path atomically. Returns false when the destination
/// already exists. Other OS/filesystem errors throw; ordinary rename is never used.
#[napi]
pub fn rename_exclusive(source: String, destination: String) -> Result<bool> {
	match rename_without_replacement(&source, &destination) {
		Ok(()) => Ok(true),
		Err(error)
			if matches!(
				error.kind(),
				io::ErrorKind::AlreadyExists | io::ErrorKind::DirectoryNotEmpty
			) =>
		{
			Ok(false)
		},
		Err(error) => {
			Err(Error::from_reason(format!("Exclusive filesystem publication failed: {error}")))
		},
	}
}

#[cfg(target_os = "linux")]
fn rename_in_original_directory(
	directory_fd: i32,
	source: &str,
	destination: &str,
) -> io::Result<()> {
	use std::{ffi::CString, mem::MaybeUninit};

	fn component(value: &str) -> io::Result<CString> {
		if value.is_empty() || value == "." || value == ".." || value.contains('/') {
			return Err(io::Error::new(
				io::ErrorKind::InvalidInput,
				"One relative filename component required",
			));
		}
		CString::new(value)
			.map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "Filename contains NUL"))
	}
	let source = component(source)?;
	let destination = component(destination)?;
	if directory_fd < 0 {
		return Err(io::Error::new(
			io::ErrorKind::InvalidInput,
			"Original directory descriptor required",
		));
	}
	let mut stats = MaybeUninit::<libc::stat>::uninit();
	// SAFETY: fstat writes into a valid stat allocation. The caller retains this
	// descriptor until the synchronous call returns; this function never closes it.
	if unsafe { libc::fstat(directory_fd, stats.as_mut_ptr()) } != 0 {
		return Err(io::Error::last_os_error());
	}
	// SAFETY: Successful fstat initialized the complete allocation.
	let stats = unsafe { stats.assume_init() };
	if stats.st_mode & libc::S_IFMT != libc::S_IFDIR {
		return Err(io::Error::new(io::ErrorKind::InvalidInput, "Descriptor must name a directory"));
	}
	// SAFETY: Both CString allocations and the caller-retained descriptor remain
	// live. Single components cannot escape the original directory. No replacing
	// rename or pathname-based fallback is attempted on any filesystem error.
	let result = unsafe {
		libc::renameat2(
			directory_fd,
			source.as_ptr(),
			directory_fd,
			destination.as_ptr(),
			libc::RENAME_NOREPLACE,
		)
	};
	if result == 0 {
		Ok(())
	} else {
		Err(io::Error::last_os_error())
	}
}

#[cfg(not(target_os = "linux"))]
fn rename_in_original_directory(
	_directory_fd: i32,
	_source: &str,
	_destination: &str,
) -> io::Result<()> {
	Err(io::Error::new(
		io::ErrorKind::Unsupported,
		"Original-directory exclusive rename is unavailable on this platform",
	))
}

/// Rename two single-component names relative to the same retained directory
/// descriptor.
///
/// Linux only. Returns false on an existing destination; other errors
/// throw. Source identity must be verified separately after capture; this operation
/// is not an atomic expected-inode deletion or a recovery authorization.
#[napi]
pub fn rename_exclusive_at(directory_fd: i32, source: String, destination: String) -> Result<bool> {
	match rename_in_original_directory(directory_fd, &source, &destination) {
		Ok(()) => Ok(true),
		Err(error)
			if matches!(
				error.kind(),
				io::ErrorKind::AlreadyExists | io::ErrorKind::DirectoryNotEmpty
			) =>
		{
			Ok(false)
		},
		Err(error) => {
			Err(Error::from_reason(format!("Original-directory exclusive rename failed: {error}")))
		},
	}
}
