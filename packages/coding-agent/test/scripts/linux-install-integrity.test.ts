import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const repository = path.resolve(import.meta.dir, "../../../..");
const digest = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

async function fixture(failure: string, arch = "x64") {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-install-integrity-"));
	const mocks = path.join(root, "mocks"),
		assets = path.join(root, "assets"),
		install = path.join(root, "install");
	await Promise.all([mocks, assets, install].map(dir => fs.mkdir(dir)));
	const name = `xcsh-linux-${arch}`;
	const binary = '#!/bin/sh\nprintf "xcsh/22.4.4\\n"\ntouch "$TEST_ROOT/executed"\n';
	const nativeNames =
		arch === "x64"
			? ["pi_natives.linux-x64-baseline.node", "pi_natives.linux-x64-modern.node"]
			: ["pi_natives.linux-arm64.node"];
	const manifest = {
		schemaVersion: 1,
		version: "22.4.4",
		platform: "linux",
		arch,
		source: {
			repository: "f5-sales-demo/xcsh",
			commit: failure === "wrong-commit" ? "c".repeat(40) : "a".repeat(40),
			workflow: "ci.yml",
			runId: "12345",
			runAttempt: "1",
			buildPlatform: "linux-x64",
		},
		binary: {
			name,
			sha256: failure === "mismatched-provenance" ? "0".repeat(64) : digest(binary),
			size: Buffer.byteLength(binary),
		},
		natives: {
			mode: "embedded",
			files: nativeNames.map(name => ({
				name,
				sha256: digest(`synthetic ${name}`),
				size: Buffer.byteLength(`synthetic ${name}`),
			})),
		},
	};
	const data: Record<string, string> = {
		[name]: binary,
		[`${name}.sha256`]: `${failure === "incorrect-checksum" ? "0".repeat(64) : digest(binary)}  ${name}\n`,
		[`${name}.provenance.json`]: `${JSON.stringify(manifest)}\n`,
	};
	for (const nativeName of nativeNames) data[nativeName] = `synthetic ${nativeName}`;
	data[`${name}.provenance.json.sha256`] = `${digest(data[`${name}.provenance.json`]!)}  ${name}.provenance.json\n`;
	if (failure === "missing-provenance") delete data[`${name}.provenance.json`];
	if (failure === "missing-checksum") delete data[`${name}.sha256`];
	for (const [name, content] of Object.entries(data)) await fs.writeFile(path.join(assets, name), content);
	await fs.writeFile(
		path.join(root, "release.json"),
		JSON.stringify(
			{
				tag_name: "v22.4.4",
				draft: false,
				prerelease: false,
				immutable: failure !== "mutable-release",
				target_commitish: "a".repeat(40),
				assets: Object.entries(data).map(([name, content]) => ({
					name,
					digest: `sha256:${failure === "native-api-mismatch" && name.endsWith(".node") ? "0".repeat(64) : digest(content)}`,
					size: Buffer.byteLength(content),
				})),
			},
			null,
			2,
		),
	);
	await fs.writeFile(path.join(root, "tag.json"), JSON.stringify({ object: { type: "commit", sha: "a".repeat(40) } }));
	const original = {
		xcsh: "previous-binary",
		"xcsh-install.json": "previous-receipt",
		"pi_natives.linux-x64-baseline.node": "previous-native",
		"xcsh-linux-x64.provenance.json": "previous-provenance",
	};
	for (const [name, content] of Object.entries(original)) await fs.writeFile(path.join(install, name), content);
	await fs.writeFile(
		path.join(mocks, "uname"),
		'#!/bin/sh\ncase "$1" in -s) echo Linux;; -m) echo "$TEST_UNAME_ARCH";; esac\n',
		{ mode: 0o755 },
	);
	await fs.writeFile(
		path.join(mocks, "curl"),
		`#!/bin/sh
output=""
while [ "$#" -gt 0 ]; do
  case "$1" in -o|--output) output="$2"; shift 2;; -*) shift;; *) url="$1"; shift;; esac
done
case "$url" in */git/ref/tags/*) file="$TEST_ROOT/tag.json";; */releases/tags/*|*/releases/latest) file="$TEST_ROOT/release.json";; *) file="$TEST_ROOT/assets/\${url##*/}";; esac
[ -f "$file" ] || exit 22
if [ "$TEST_FAILURE" = interrupted-download ] && [ "\${file##*/}" = "xcsh-linux-$TEST_ARCH" ]; then head -c 10 "$file" > "$output"; exit 18; fi
if [ -n "$output" ]; then cp "$file" "$output"; else cat "$file"; fi
`,
		{ mode: 0o755 },
	);
	await fs.writeFile(
		path.join(mocks, "mv"),
		`#!/bin/sh
for arg do destination="$arg"; done
if { [ "$TEST_FAILURE" = promotion-failure ] && [ "\${destination##*/}" = xcsh-install.json ]; } || { [ "$TEST_FAILURE" = binary-promotion-failure ] && [ "$destination" = "$TEST_ROOT/install/xcsh" ]; } && [ ! -f "$TEST_ROOT/failed-move" ]; then touch "$TEST_ROOT/failed-move"; exit 1; fi
exec /bin/mv "$@"
`,
		{ mode: 0o755 },
	);
	const child = Bun.spawn(["sh", path.join(repository, "scripts/install.sh"), "--binary", "--ref", "v22.4.4"], {
		env: {
			...process.env,
			PATH: `${mocks}:${install}:${process.env.PATH}`,
			PI_INSTALL_DIR: install,
			TEST_ROOT: root,
			TEST_FAILURE: failure,
			TEST_ARCH: arch,
			TEST_UNAME_ARCH: arch === "x64" ? "x86_64" : "aarch64",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { root, install, original, stdout, stderr, code };
}

describe("standalone Linux integrity", () => {
	it.each([
		"missing-checksum",
		"incorrect-checksum",
		"missing-provenance",
		"mismatched-provenance",
		"interrupted-download",
		"wrong-commit",
		"mutable-release",
		"native-api-mismatch",
		"promotion-failure",
		"binary-promotion-failure",
	])("preserves the complete previous installation after %s", async failure => {
		const f = await fixture(failure);
		try {
			expect(f.code, `${f.stdout}\n${f.stderr}`).not.toBe(0);
			for (const [name, bytes] of Object.entries(f.original))
				expect(await fs.readFile(path.join(f.install, name), "utf8")).toBe(bytes);
			if (!failure.endsWith("promotion-failure"))
				expect(await Bun.file(path.join(f.root, "executed")).exists()).toBe(false);
		} finally {
			await fs.rm(f.root, { recursive: true, force: true });
		}
	});
	it.each(["x64", "arm64"])("activates only the verified embedded-addon %s release", async arch => {
		const f = await fixture("success", arch);
		try {
			expect(f.code, `${f.stdout}\n${f.stderr}`).toBe(0);
			expect(await fs.readFile(path.join(f.install, "xcsh"), "utf8")).toContain("xcsh/22.4.4");
			expect(JSON.parse(await fs.readFile(path.join(f.install, "xcsh-install.json"), "utf8"))).toMatchObject({
				version: "22.4.4",
				arch,
			});
			expect(await Bun.file(path.join(f.install, `xcsh-linux-${arch}.provenance.json`)).exists()).toBe(true);
		} finally {
			await fs.rm(f.root, { recursive: true, force: true });
		}
	});
});
