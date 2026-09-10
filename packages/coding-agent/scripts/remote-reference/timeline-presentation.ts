/** Compile the original pinned Rust presentation selector to regenerate independent expectations. */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const source = process.argv[2];
assert(source, "Usage: bun timeline-presentation.ts <pinned-codex-checkout>");
const sourceCommit = "3d2ee51ca2d5db578f328aa75e20aa22c0197c9a";
const sourceFile = "codex-rs/core/src/realtime_history/presentation.rs";
const sourceSha256 = "511a037bdefd287b8dfaf965943881158d8d03a26e0e75dcfb28a172b066dd61";
const original = await Bun.file(join(resolve(source), sourceFile)).text();
assert.equal(new Bun.CryptoHasher("sha256").update(original).digest("hex"), sourceSha256);
const constants = original.slice(
	original.indexOf("const INLINE_MARKDOWN_DIRECTIVE"),
	original.indexOf("impl RealtimeHistoryState"),
);
const method = original.slice(
	original.indexOf("    pub(super) fn observe_assistant_message("),
	original.lastIndexOf("\n}"),
);
assert(constants && method.startsWith("    pub(super) fn observe_assistant_message("));
const markdown = "::codex-realtime-inline{}";
const visualize = "::codex-inline-vis{}";
const inputs = [
	"",
	markdown,
	`${markdown}\n`,
	`${markdown}\r\nFixture`,
	`${markdown}\rFixture`,
	`${markdown} \nFixture`,
	`[FINAL] ${markdown}\nFixture`,
	`[anything]\n${markdown}\nFixture`,
	`[FINAL]\n ${markdown}\nFixture`,
	`\u0085${markdown}\nFixture`,
	`\ufeff${markdown}\nFixture`,
	`\u2007${markdown}\nFixture`,
	`[FINAL]\u0085${markdown}\nFixture`,
	visualize,
	`Text\n${visualize}\nvisualize{}`,
	`\u0085${visualize}`,
	`\ufeff${visualize}`,
	`\`\`\`\n${visualize}\n\`\`\`\nvisualize{}`,
	`~~~fixture\n${visualize}\n~~~`,
	`\`\`\`\n${visualize}\n~~~\n${visualize}`,
	`${markdown}\n${visualize}`,
	`Text ${visualize}`,
	`Text\r${visualize}`,
	`[FINAL] ${visualize}`,
	`::codex-inline-vis{partial`,
];
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
const directory = await mkdtemp(join(tmpdir(), "xcsh-timeline-presentation-"));
try {
	// Only the event/type adapters are local. The selector and constants remain byte-for-byte source slices.
	const driver = `#![allow(dead_code)]
mod fixture {
${constants}
enum BemItemPresentation { InlineMarkdown, InlineVisualization { index: u32 } }
type RealtimeItem = BemItemPresentation;
struct RealtimeHistoryState;
impl RealtimeHistoryState {
    fn add_promotion(&mut self, items: &mut Vec<RealtimeItem>, _: &str, _: &str, presentation: BemItemPresentation) { items.push(presentation); }
${method}
}
pub fn evaluate(text: &str) -> String {
    let mut items = Vec::new();
    RealtimeHistoryState.observe_assistant_message(&mut items, "turn", "item", text);
    let encoded: Vec<String> = items.iter().map(|item| match item {
        BemItemPresentation::InlineMarkdown => r#"{"type":"inlineMarkdown"}"#.to_string(),
        BemItemPresentation::InlineVisualization { index } => format!(r#"{{"type":"inlineVisualization","index":{}}}"#, index),
    }).collect();
    format!("[{}]", encoded.join(","))
}
}
fn main() {
    for text in [${inputs.map(value => JSON.stringify(value)).join(",")} ] { println!("{}", fixture::evaluate(text)); }
}
`;
	await Bun.write(join(directory, "main.rs"), driver);
	await run(["rustc", "--edition=2024", join(directory, "main.rs"), "-o", join(directory, "reference")]);
	const output = (await run([join(directory, "reference")]))
		.trim()
		.split("\n")
		.map(line => JSON.parse(line));
	assert.equal(output.length, inputs.length);
	await Bun.write(
		join(import.meta.dir, "../../test/remote-control/fixtures/codex-0.153.4-timeline-presentation.json"),
		`${JSON.stringify({ sourceCommit, sourceFile, sourceSha256, evidence: "Original Rust observe_assistant_message and constants; no service or phone capture", cases: inputs.map((text, index) => ({ text, presentations: output[index] })) }, null, 2)}\n`,
	);
	console.log(`Generated ${inputs.length} original Rust presentation cases`);
} finally {
	await rm(directory, { recursive: true, force: true });
}
