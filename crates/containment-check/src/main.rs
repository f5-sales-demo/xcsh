//! Drives the containment fence's OS backend directly, for verification.
//!
//! `crates/brush-core-vendored` is `exclude`d from the workspace and reached
//! only through `[patch.crates-io]`, so `cargo test -p brush-core` refuses to
//! run and its containment code has never had runnable Rust tests. This crate
//! is a workspace member that depends on brush-core by path, which
//! is what makes `cargo test -p containment-check` exercise that code for real.
//!
//! It exists to answer two questions that a unit test cannot:
//!
//! - what does the fence compile to on this machine (`plan`),
//! - and does a spawned command actually get refused (`run`) — through the
//!   shipped `compose_std_command` path, with no reimplementation of the
//!   mechanism.

use std::path::PathBuf;

use brush_core::containment::{ContainmentFence, GrantPlan, RealFs};
use clap::{Parser, Subcommand};

/// The fence as JSON, matching the four lists the napi boundary already passes.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FenceJson {
	#[serde(default)]
	allow:            Vec<PathBuf>,
	#[serde(default)]
	allow_read_only:  Vec<PathBuf>,
	#[serde(default)]
	allow_write_only: Vec<PathBuf>,
	#[serde(default)]
	deny:             Vec<PathBuf>,
}

impl From<FenceJson> for ContainmentFence {
	fn from(json: FenceJson) -> Self {
		Self {
			allow:            json.allow,
			allow_read_only:  json.allow_read_only,
			allow_write_only: json.allow_write_only,
			deny:             json.deny,
		}
	}
}

#[derive(Parser)]
#[command(about = "Verify the containment fence's OS backend")]
struct Cli {
	#[command(subcommand)]
	command: Command,
}

#[derive(Subcommand)]
enum Command {
	/// Print what a fence compiles to on this machine.
	Plan {
		/// The fence, as JSON.
		#[arg(long)]
		fence: String,
	},
	/// Report whether an OS containment backend is usable here.
	///
	/// Exits non-zero when there is none, so a verification script cannot
	/// mistake "no backend" for "nothing to test" — a security check that skips
	/// silently reads exactly like one that passed.
	Status,
	/// Run a command through the real shell, optionally fenced, and report what
	/// happened.
	///
	/// This is the empirical leg: it goes through `compose_std_command`, so it
	/// exercises the shipped mechanism rather than a reimplementation of it.
	Run {
		/// The fence, as JSON. Omit to run unfenced — the control case.
		#[arg(long)]
		fence:   Option<String>,
		/// Working directory for the command.
		#[arg(long)]
		cwd:     Option<PathBuf>,
		/// The command line to run.
		command: String,
	},
}

#[tokio::main(flavor = "multi_thread")]
async fn main() -> std::process::ExitCode {
	let cli = Cli::parse();
	match cli.command {
		Command::Plan { fence } => match parse_fence(&fence) {
			Ok(fence) => {
				print_plan(&fence.compile_grant_plan(&RealFs));
				std::process::ExitCode::SUCCESS
			},
			Err(code) => code,
		},
		Command::Status => report_status(),
		Command::Run { fence, cwd, command } => {
			let fence = match fence.as_deref().map(parse_fence) {
				Some(Ok(fence)) => Some(fence),
				Some(Err(code)) => return code,
				None => None,
			};
			run_command(fence, cwd, &command).await
		},
	}
}

fn parse_fence(raw: &str) -> Result<ContainmentFence, std::process::ExitCode> {
	serde_json::from_str::<FenceJson>(raw)
		.map(ContainmentFence::from)
		.map_err(|err| {
			eprintln!("could not parse --fence as JSON: {err}");
			std::process::ExitCode::FAILURE
		})
}

/// Report the backend, exiting non-zero when there is none.
#[cfg(target_os = "linux")]
fn report_status() -> std::process::ExitCode {
	use brush_core::sys::landlock::{Availability, availability, handled_rights, truncate_handled};

	match availability() {
		Availability::Available(abi) => {
			println!("backend: landlock");
			println!("abi: {abi}");
			println!("handled_access_fs: {:#x}", handled_rights(abi));
			println!("truncate_handled: {}", truncate_handled(abi));
			std::process::ExitCode::SUCCESS
		},
		Availability::Unavailable(reason) => {
			println!("backend: scanner-only");
			println!("reason: {}", reason.reason());
			eprintln!(
				"NO OS BACKEND HERE — an enforcement check on this machine would prove nothing.\nRun \
				 it somewhere Landlock is available, or fix the environment. Not skipping quietly."
			);
			std::process::ExitCode::FAILURE
		},
	}
}

#[cfg(not(target_os = "linux"))]
fn report_status() -> std::process::ExitCode {
	println!(
		"backend: {}",
		if cfg!(target_os = "macos") {
			"seatbelt"
		} else {
			"scanner-only"
		}
	);
	eprintln!("this subcommand reports the Landlock backend, which only exists on Linux");
	std::process::ExitCode::FAILURE
}

/// Run `command` through a real brush shell, mirroring how the host configures
/// one.
async fn run_command(
	fence: Option<ContainmentFence>,
	cwd: Option<PathBuf>,
	command: &str,
) -> std::process::ExitCode {
	use brush_builtins::{BuiltinSet, default_builtins};
	use brush_core::{CreateOptions, Shell};

	let options = CreateOptions {
		interactive: false,
		login: false,
		no_profile: true,
		no_rc: true,
		do_not_inherit_env: true,
		builtins: default_builtins(BuiltinSet::BashMode),
		..Default::default()
	};
	let mut shell = match Shell::new(options).await {
		Ok(shell) => shell,
		Err(err) => {
			eprintln!("could not create shell: {err}");
			return std::process::ExitCode::FAILURE;
		},
	};
	if let Some(cwd) = cwd
		&& let Err(err) = shell.set_working_dir(&cwd)
	{
		eprintln!("could not enter {}: {err}", cwd.display());
		return std::process::ExitCode::FAILURE;
	}

	let mut params = shell.default_exec_params();
	// Exactly how `pi-natives` supplies the fence, so this drives the shipped path.
	params.containment = fence.map(std::sync::Arc::new);

	match shell.run_string(command, &params).await {
		Ok(result) => {
			let code = u8::from(result.exit_code);
			println!("exit: {code}");
			std::process::ExitCode::from(code)
		},
		Err(err) => {
			// A refusal is a result, not a crash: print it so a script can assert on the
			// wording.
			println!("error: {err}");
			std::process::ExitCode::from(126)
		},
	}
}

fn print_plan(plan: &GrantPlan) {
	println!("grants ({}):", plan.grants.len());
	for (path, rights) in &plan.grants {
		let mode = match (rights.read, rights.write) {
			(true, true) => "rw",
			(true, false) => "r-",
			(false, true) => "-w",
			(false, false) => "--",
		};
		println!("  {mode} {}", path.display());
	}
	println!("split dirs ({}) — these lost a right on their own inode:", plan.split_dirs.len());
	for path in &plan.split_dirs {
		println!("  {}", path.display());
	}
	if !plan.unenumerable.is_empty() {
		println!("unenumerable ({}) — nothing granted beneath these:", plan.unenumerable.len());
		for path in &plan.unenumerable {
			println!("  {}", path.display());
		}
	}
}
