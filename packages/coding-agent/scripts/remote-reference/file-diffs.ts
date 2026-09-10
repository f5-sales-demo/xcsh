/** Generate diff fixtures with the exact library version used by pinned Codex. */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [source, library] = process.argv.slice(2);
assert(source && library, "Usage: bun file-diffs.ts <pinned-codex-checkout> <similar-2.7.0-source>");
const sourceFile = "codex-rs/apply-patch/src/file_update.rs";
const sourceSha256 = "f954105ba036f1c3748fc2ed605ce9a677d619e56ce25f89bffdcad3377734f9";
const original = await Bun.file(join(resolve(source), sourceFile)).text();
assert.equal(new Bun.CryptoHasher("sha256").update(original).digest("hex"), sourceSha256);
assert.match(original, /TextDiff::from_lines\(&original_contents, &new_contents\)/);
assert.match(original, /unified_diff\(\).context_radius\(context\).to_string\(\)/);
assert.match(await Bun.file(join(library, "Cargo.toml")).text(), /version = "2\.7\.0"/);
const cases = [
	{ before: "", after: "", context: 1 },
	{ before: "", after: "new\n", context: 1 },
	{ before: "old\n", after: "", context: 1 },
	{ before: "old", after: "new", context: 1 },
	{ before: "old\n", after: "new", context: 1 },
	{ before: "same\n", after: "same", context: 1 },
	{ before: "a\rb\r", after: "a\rc\r", context: 1 },
	{ before: "a\r\nb\r\n", after: "a\r\nc\r\n", context: 1 },
	{ before: "\ufeffΩ\n終\n", after: "\ufeffΩ\n始\n", context: 1 },
	{ before: "a\nb\nc\nd\ne\nf\ng\n", after: "a\nB\nc\nd\ne\nF\ng\n", context: 1 },
	{ before: "a\nb\na\nb\nc\n", after: "b\na\nb\nc\na\n", context: 0 },
	{ before: "a\nb\nc\n", after: "a\nnew\nb\nc\n", context: 4 },
];
let seed = 3818;
const random = (n: number) => {
	seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
	return seed % n;
};
for (let index = 0; index < 128; index++) {
	const lines = Array.from({ length: 1 + random(15) }, () => ["a", "b", "", "Ω", "end"][random(5)]);
	const next = [...lines];
	next.splice(
		random(next.length),
		random(4),
		...Array.from({ length: random(4) }, () => ["a", "b", "", "Ω", "new"][random(5)]),
	);
	cases.push({
		before: lines.join("\n") + (random(2) ? "\n" : ""),
		after: next.join("\n") + (random(2) ? "\n" : ""),
		context: random(4),
	});
}
const directory = await mkdtemp(join(tmpdir(), "xcsh-file-diffs-"));
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
const rustString = (value: string) => `String::from_utf8(vec![${[...Buffer.from(value)].join(",")}]).unwrap()`;
try {
	await run([
		"rustc",
		"--edition=2018",
		"--crate-name",
		"similar",
		"--crate-type",
		"rlib",
		"--cfg",
		'feature="text"',
		join(library, "src/lib.rs"),
		"-o",
		join(directory, "libsimilar.rlib"),
	]);
	await Bun.write(
		join(directory, "main.rs"),
		`use similar::TextDiff;
fn main() { ${cases
			.map(
				value => `{
let original_contents = ${rustString(value.before)}; let new_contents = ${rustString(value.after)}; let context = ${value.context};
let text_diff = TextDiff::from_lines(&original_contents, &new_contents);
let unified_diff = text_diff.unified_diff().context_radius(context).to_string();
println!("{}", unified_diff.as_bytes().iter().map(|b| format!("{b:02x}")).collect::<String>());
}`,
			)
			.join("\n")} }`,
	);
	await run([
		"rustc",
		"--edition=2024",
		join(directory, "main.rs"),
		"--extern",
		`similar=${join(directory, "libsimilar.rlib")}`,
		"-o",
		join(directory, "fixture"),
	]);
	const outputs = (await run([join(directory, "fixture")])).split("\n");
	assert.equal(outputs.pop(), "");
	assert.equal(outputs.length, cases.length);
	console.log(
		JSON.stringify(
			{
				sourceCommit: "3d2ee51ca2d5db578f328aa75e20aa22c0197c9a",
				sourceFile,
				sourceSha256,
				library: "similar 2.7.0",
				cases: cases.map((value, index) => ({
					...value,
					expected: Buffer.from(outputs[index], "hex").toString("utf8"),
				})),
			},
			null,
			2,
		),
	);
} finally {
	await rm(directory, { recursive: true, force: true });
}
