/** Regenerate source-contract fixtures using the original pinned Rust truncator. */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const source = process.argv[2];
assert(source, "Usage: bun completed-output.ts <pinned-codex-checkout>");
const sourceCommit = "3d2ee51ca2d5db578f328aa75e20aa22c0197c9a";
const sourceFile = "codex-rs/utils/string/src/truncate.rs";
const checkout = resolve(source);
const input = [
	{ unit: "a", count: 4000 },
	{ unit: "a", count: 4001 },
	{ unit: "a", count: 6000 },
	{ unit: "🌳", count: 2000 },
	{ head: "HEAD", unit: "é🌳z", count: 1100, tail: "TAIL" },
];
async function run(args: string[]): Promise<string> {
	const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	assert.equal(code, 0, stderr);
	return stdout;
}
const sha = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");
const original = await Bun.file(join(checkout, sourceFile)).text();
assert.equal(
	sha(original),
	"51a22c8252db01b668f312e17c87c43c1abd96fc46ac3cfca0a85d45f6dc4d71",
	"Pinned truncator differs",
);
const budgetSourceFile = "codex-rs/core/src/realtime_context.rs";
const core = await Bun.file(join(checkout, budgetSourceFile)).text();
assert.equal(
	sha(core),
	"4e140443503e80030f19b5d07d72c36238f4f50a5bed17463c11376223c40140",
	"Pinned budget loop differs",
);
const start = core.indexOf("pub(crate) fn truncate_realtime_text_to_token_budget(");
const end = core.indexOf("\nasync fn build_workspace_section", start);
assert(start >= 0 && end > start);
const directory = await mkdtemp(join(tmpdir(), "xcsh-completed-output-"));
try {
	// Import both original operations, independently of native xcsh code. Small
	// adapters replace the crate-level reexports without changing either function.
	const driver = `#![allow(dead_code)]
#[path = ${JSON.stringify(join(checkout, sourceFile))}]
mod truncate;
use truncate::approx_token_count;
enum TruncationPolicy { Tokens(usize) }
fn truncate_text(text: &str, policy: TruncationPolicy) -> String {
    let TruncationPolicy::Tokens(tokens) = policy;
    truncate::truncate_middle_with_token_budget(text, tokens).0
}
${core.slice(start, end)}
fn main() {
    let inputs = [${input.map(item => `format!("{}{}{}", ${JSON.stringify(item.head ?? "")}, ${JSON.stringify(item.unit)}.repeat(${item.count}), ${JSON.stringify(item.tail ?? "")})`).join(",")}];
    println!("{:?}", inputs.iter().map(|text| truncate_realtime_text_to_token_budget(text, 1000)).collect::<Vec<_>>());
}
`;
	await Bun.write(join(directory, "main.rs"), driver);
	await run(["rustc", "--edition=2024", join(directory, "main.rs"), "-o", join(directory, "reference")]);
	const output: string[] = JSON.parse(await run([join(directory, "reference")]));
	const fixture = {
		sourceCommit,
		sourceFile,
		sourceSha256: sha(original),
		budgetSourceFile,
		budgetSourceSha256: sha(core),
		budgetTokens: 1000,
		evidence:
			"Original pinned Rust string truncator with the realtime_context.rs budget loop; no service or phone capture",
		cases: input.map((input, index) => ({
			input,
			bytes: Buffer.byteLength(output[index]),
			sha256: sha(output[index]),
		})),
	};
	await Bun.write(
		join(import.meta.dir, "../../test/remote-control/fixtures/codex-0.153.4-completed-output.json"),
		`${JSON.stringify(fixture, null, 2)}\n`,
	);
	console.log(`Generated ${fixture.cases.length} pinned completed-output fixtures`);
} finally {
	await rm(directory, { recursive: true, force: true });
}
