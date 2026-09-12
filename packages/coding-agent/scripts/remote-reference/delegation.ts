/** Generate delegation fixtures by executing the pinned Rust formatter. */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const sourceFile = "codex-rs/core/src/context/realtime_delegation.rs";
const sourceSha256 = "58a6b5cfb7c19aed99431f855e440f1cc22e776b7faa264a40e06eff789780c9";
const source = process.argv[2];
assert(source, "Usage: bun delegation.ts <pinned-codex-root>");
const original = await Bun.file(join(resolve(source), sourceFile)).text();
assert.equal(new Bun.CryptoHasher("sha256").update(original).digest("hex"), sourceSha256);
const renderSourceFile = "codex-rs/context-fragments/src/fragment.rs";
const renderSourceSha256 = "b48f8533c5f4eb7e8f102c2ab86a9e436e1daae0669f6cb214b06c32365c5dff";
const fragment = await Bun.file(join(resolve(source), renderSourceFile)).text();
assert.equal(new Bun.CryptoHasher("sha256").update(fragment).digest("hex"), renderSourceSha256);
const renderStart = fragment.indexOf("    fn render(&self) -> String {");
assert(renderStart >= 0);
const renderEnd = fragment.indexOf("\n    }\n", renderStart);
assert(renderEnd > renderStart);
const render = fragment.slice(renderStart, renderEnd + 6);
const cases = [
	{ input: "", transcript: null, tail: false },
	{ input: "hello", transcript: null, tail: false },
	{ input: "hello", transcript: "", tail: false },
	{ input: "use a < b && c > d", transcript: "saw <that>", tail: false },
	{ input: "  space\n", transcript: "user: hello\nassistant: hi", tail: false },
	{ input: "'quoted' \"text\"", transcript: "user: Ω🌳", tail: true },
	...[4092, 4093, 4094, 4095, 4096, 4097].map(size => ({
		input: "x".repeat(size),
		transcript: "y".repeat(size),
		tail: false,
	})),
	{ input: "🌳".repeat(1500), transcript: "Ω".repeat(3000), tail: false },
	{ input: "<".repeat(1500), transcript: "&".repeat(1500), tail: true },
];
const directory = await mkdtemp(join(tmpdir(), "xcsh-delegation-"));
async function run(args: string[]) {
	const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	assert.equal(code, 0, err);
	return out;
}
const str = (value: string) => `String::from_utf8(vec![${[...Buffer.from(value)].join(",")}]).unwrap()`;
try {
	await Bun.write(
		join(directory, "main.rs"),
		`#![allow(dead_code)]
mod codex_protocol { pub mod models {pub struct ContentItemKind(pub String);} }
trait ContextualUserFragment {fn content_kind(&self)->codex_protocol::models::ContentItemKind;fn role(&self)->&'static str;fn markers(&self)->(&'static str,&'static str);fn type_markers()->(&'static str,&'static str);fn body(&self)->String;${render}}
mod reference {use crate::codex_protocol;${original}}
fn main(){${cases.map(c => `{let input=${str(c.input)};let transcript:Option<String>=${c.transcript === null ? "None" : `Some(${str(c.transcript)})`};let value=reference::RealtimeDelegation::new(&input,transcript.as_deref(),reference::RealtimeDelegationSource::${c.tail ? "TranscriptTailFlush" : "Handoff"}).render();for b in value.as_bytes(){print!("{:02x}",b);}println!();}`).join("\n")}}
`,
	);
	await run(["rustc", "--edition=2021", join(directory, "main.rs"), "-o", join(directory, "formatter")]);
	const lines = (await run([join(directory, "formatter")])).trimEnd().split("\n");
	assert.equal(lines.length, cases.length);
	process.stdout.write(
		JSON.stringify(
			{
				sourceFile,
				sourceSha256,
				renderSourceFile,
				renderSourceSha256,
				cases: cases.map((value, index) => ({
					...value,
					expected: Buffer.from(lines[index], "hex").toString("utf8"),
				})),
			},
			null,
			2,
		),
	);
	process.stdout.write("\n");
} finally {
	await rm(directory, { recursive: true, force: true });
}
