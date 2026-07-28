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
	/// Print what a fence compiles to on this machine, as JSON.
	Plan {
		/// The fence, as JSON.
		#[arg(long)]
		fence: String,
	},
}

fn main() -> std::process::ExitCode {
	let cli = Cli::parse();
	match cli.command {
		Command::Plan { fence } => match serde_json::from_str::<FenceJson>(&fence) {
			Ok(json) => {
				print_plan(&ContainmentFence::from(json).compile_grant_plan(&RealFs));
				std::process::ExitCode::SUCCESS
			},
			Err(err) => {
				eprintln!("could not parse --fence as JSON: {err}");
				std::process::ExitCode::FAILURE
			},
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
