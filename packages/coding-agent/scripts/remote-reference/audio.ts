/** Execute the pinned Rust audio parsing bodies to generate independent wire fixtures. */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const [source, serdeLibrary, compiler = "rustc"] = process.argv.slice(2);
assert(source && serdeLibrary, "Usage: bun audio.ts <pinned-codex-root> <serde_json-rlib> [matching-rustc]");
const sources = {
	"protocol_v1.rs": "9ee5ac9d9ddd2963bd5ab2359fa55e93d6c41d9405712ea9d8947885fba5faf1",
	"protocol_frameless_bidi.rs": "faa6826b1884ccceb564e8bb6bd60048f7900ffcc5b50fcacbd840b03a173515",
};
const prefix = "codex-rs/codex-api/src/endpoint/realtime_websocket";
const originals: string[] = [];
for (const [name, hash] of Object.entries(sources)) {
	const original = await Bun.file(join(resolve(source), prefix, name)).text();
	assert.equal(new Bun.CryptoHasher("sha256").update(original).digest("hex"), hash);
	originals.push(original);
}
const [v1, v3] = originals;
const v1Start = v1.indexOf("            let data =");
const v1End = v1.indexOf("\n        }", v1Start);
const v3Start = v3.indexOf("fn parse_output_audio_delta(");
const v3End = v3.indexOf("\n}", v3Start) + 2;
assert(v1Start >= 0 && v1End > v1Start && v3Start >= 0 && v3End > v3Start);
const base = { type: "conversation.output_audio.delta", delta: "AAABAA==", sample_rate: 24000, channels: 1 };
const cases: { version: string; input: Record<string, unknown> }[] = [{ version: "v1", input: base }];
for (const key of ["sample_rate", "channels", "samples_per_channel"])
	for (const value of [0, 1, 120, 65535, 65536, 4294967295, 4294967296, -1, 0.5, null, "120"])
		cases.push({ version: "v1", input: { ...base, [key]: value } });
const { channels: _channels, ...withoutChannels } = base;
cases.push(
	{ version: "v1", input: { ...base, delta: 12, data: base.delta } },
	{ version: "v1", input: { ...base, channels: null, num_channels: 2 } },
	{ version: "v1", input: { ...withoutChannels, num_channels: 2 } },
	{
		version: "v3",
		input: {
			type: "output_audio.delta",
			audio: base.delta,
			sample_rate: 48000,
			channels: 2,
			samples_per_channel: 120,
			item_id: "ignored",
		},
	},
);
const directory = await mkdtemp(join(tmpdir(), "xcsh-audio-reference-"));
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
try {
	await Bun.write(join(directory, "input.json"), JSON.stringify(cases));
	await Bun.write(
		join(directory, "main.rs"),
		`
use serde_json::{Value,json};
struct RealtimeAudioFrame {data:String,sample_rate:u32,num_channels:u16,samples_per_channel:Option<u32>,item_id:Option<String>}
enum RealtimeEvent {AudioOut(RealtimeAudioFrame)}
const DEFAULT_AUDIO_SAMPLE_RATE:u32=24000; const DEFAULT_AUDIO_CHANNELS:u16=1;
fn v1(parsed:&Value)->Option<RealtimeEvent>{${v1.slice(v1Start, v1End)}}
${v3.slice(v3Start, v3End)}
fn main(){
 let data=std::fs::read_to_string(std::env::args().nth(1).unwrap()).unwrap();
 let cases:Value=serde_json::from_str(&data).unwrap();let mut results=vec![];
 for c in cases.as_array().unwrap(){
  let event=if c["version"]=="v1" {v1(&c["input"])}else{parse_output_audio_delta(&c["input"])};
  let result=event.map(|RealtimeEvent::AudioOut(f)|json!({"data":f.data,"sampleRate":f.sample_rate,"numChannels":f.num_channels,"samplesPerChannel":f.samples_per_channel,"itemId":f.item_id}));
  results.push(json!({"version":c["version"],"input":c["input"],"expected":result}));
 }
 println!("{}",json!(results));
}
`,
	);
	await run([
		compiler,
		"--edition=2021",
		join(directory, "main.rs"),
		"--extern",
		`serde_json=${resolve(serdeLibrary)}`,
		"-L",
		`dependency=${dirname(resolve(serdeLibrary))}`,
		"-o",
		join(directory, "parser"),
	]);
	const outputs = JSON.parse(await run([join(directory, "parser"), join(directory, "input.json")]));
	assert.equal(outputs.length, cases.length);
	console.log(
		JSON.stringify({ sourceCommit: "3d2ee51ca2d5db578f328aa75e20aa22c0197c9a", sources, cases: outputs }, null, 2),
	);
} finally {
	await rm(directory, { recursive: true, force: true });
}
