/** Execute the pinned Rust file-change converter to generate independent wire fixtures. */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const source = process.argv[2];
assert(source, "Usage: bun file-changes.ts <pinned-codex-checkout>");
const sourceFile = "codex-rs/app-server-protocol/src/protocol/item_builders.rs";
const sourceSha256 = "6fd5de82a66e47eef2b9bc878770c6061a27d64ae9dbd3e9efd176b962155f04";
const original = await Bun.file(join(resolve(source), sourceFile)).text();
assert.equal(new Bun.CryptoHasher("sha256").update(original).digest("hex"), sourceSha256);
const converter = original.slice(original.indexOf("pub fn convert_patch_changes("), original.indexOf("\n#[cfg(test)]"));
assert(converter.includes("fn format_file_change_diff("));
type FixtureChange =
	| { path: string; type: "add"; content: string }
	| { path: string; type: "delete"; content: string }
	| { path: string; type: "update"; unifiedDiff: string; movePath: string | null };
const inputs: FixtureChange[][] = [
	[],
	[{ path: "/fixture/new.txt", type: "add", content: "added\n" }],
	[{ path: "/fixture/deleted.txt", type: "delete", content: "deleted without newline" }],
	[{ path: "/fixture/edit.txt", type: "update", unifiedDiff: "@@ -1 +1 @@\n-old\n+new\n", movePath: null }],
	[{ path: "/fixture/move.txt", type: "update", unifiedDiff: "", movePath: "/fixture/renamed.txt" }],
	[
		{ path: "/fixture/\u{10000}", type: "add", content: "" },
		{ path: "/fixture/\ue000", type: "delete", content: "Unicode Ω\r\n" },
		{ path: "/fixture/a", type: "update", unifiedDiff: "@@ -1 +1 @@\n-a\n+b\n", movePath: "/fixture/b" },
	],
];
const rustString = (value: string) => `String::from_utf8(vec![${[...Buffer.from(value)].join(",")}]).unwrap()`;
const cases = inputs
	.map(
		(changes, index) => `{
let mut changes = HashMap::new();
${changes
	.map(change => {
		const value =
			change.type === "add" || change.type === "delete"
				? `FileChange::${change.type === "add" ? "Add" : "Delete"} { content: ${rustString(change.content)} }`
				: `FileChange::Update { unified_diff: ${rustString(change.unifiedDiff)}, move_path: ${change.movePath === null ? "None" : `Some(PathBuf::from(${rustString(change.movePath)}))`} }`;
		return `changes.insert(PathBuf::from(${rustString(change.path)}), ${value});`;
	})
	.join("\n")}
for item in convert_patch_changes(&changes) {
 let (kind, moved) = match item.kind { PatchChangeKind::Add => ("add", None), PatchChangeKind::Delete => ("delete", None), PatchChangeKind::Update { move_path } => ("update", move_path) };
 println!("${index}|{}|{}|{}|{}", hex(&item.path), kind, moved.map(|p| hex(&p.to_string_lossy())).unwrap_or(String::from("-")), hex(&item.diff));
}
}`,
	)
	.join("\n");
const directory = await mkdtemp(join(tmpdir(), "xcsh-file-changes-"));
async function run(args: string[]) {
	const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	assert.equal(code, 0, stderr);
	return stdout;
}
try {
	await Bun.write(
		join(directory, "main.rs"),
		`#![allow(private_interfaces)]
use std::{collections::HashMap, path::PathBuf};
enum FileChange { Add { content: String }, Delete { content: String }, Update { unified_diff: String, move_path: Option<PathBuf> } }
enum PatchChangeKind { Add, Delete, Update { move_path: Option<PathBuf> } }
struct FileUpdateChange { path: String, kind: PatchChangeKind, diff: String }
${converter}
fn hex(value: &str) -> String { value.as_bytes().iter().map(|b| format!("{b:02x}")).collect() }
fn main() { ${cases} }
`,
	);
	await run(["rustc", "--edition=2024", join(directory, "main.rs"), "-o", join(directory, "fixture")]);
	const outputs: Record<string, unknown>[][] = inputs.map(() => []);
	const decode = (value: string) => Buffer.from(value, "hex").toString("utf8");
	for (const row of (await run([join(directory, "fixture")])).trim().split("\n")) {
		const [index, path, type, moved, diff] = row.split("|");
		outputs[Number(index)].push({
			path: decode(path),
			kind: type === "update" ? { type, move_path: moved === "-" ? null : decode(moved) } : { type },
			diff: decode(diff),
		});
	}
	console.log(
		JSON.stringify(
			{
				sourceCommit: "3d2ee51ca2d5db578f328aa75e20aa22c0197c9a",
				sourceFile,
				sourceSha256,
				cases: inputs.map((changes, index) => ({ changes, expected: outputs[index] })),
			},
			null,
			2,
		),
	);
} finally {
	await rm(directory, { recursive: true, force: true });
}
