import { expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const installer = resolve(import.meta.dir, "../../../../scripts/install.sh");

for (const [name, token, variable = "GH_TOKEN"] of [
	["underscore", "synthetic_test_token"],
	["period and hyphen", "synthetic.header-signature.part"],
	["bearer alphabet and padding", "synthetic~bearer+/token=="],
	["GITHUB_TOKEN fallback", "synthetic.fallback-token", "GITHUB_TOKEN"],
])
	it(`authenticates metadata with ${name} without leaking curl argv`, async () => {
		const root = await mkdtemp(join(tmpdir(), "xcsh-installer-auth-"));
		const mocks = join(root, "mocks");
		await mkdir(mocks);
		await writeFile(join(mocks, "uname"), '#!/bin/sh\ncase "$1" in -s) echo Darwin;; -m) echo arm64;; esac\n', {
			mode: 0o755,
		});
		await writeFile(
			join(mocks, "curl"),
			`#!/bin/sh
config=""; output=""; url=""
printf '%s\\n' "$@" >> "$TEST_ROOT/argv"
while [ "$#" -gt 0 ]; do
 case "$1" in --config) config="$2"; shift 2;; -o|--output) output="$2"; shift 2;; -*) shift;; *) url="$1"; shift;; esac
done
if [ "$config" = - ]; then cat >> "$TEST_ROOT/config"; fi
case "$url" in
 https://api.github.com/*) printf '%s' '{"tag_name":"v22.4.6","draft":false,"prerelease":false,"immutable":true,"assets":[{"name":"xcsh-darwin-arm64","digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}' > "$output";;
 *) if [ -n "$config" ]; then touch "$TEST_ROOT/leaked"; fi; exit 22;;
esac
`,
			{ mode: 0o755 },
		);
		try {
			const child = Bun.spawn(["sh", installer, "--binary", "--ref", "v22.4.6"], {
				env: {
					...process.env,
					PATH: `${mocks}:${process.env.PATH}`,
					TEST_ROOT: root,
					PI_INSTALL_DIR: join(root, "install"),
					GH_TOKEN: variable === "GH_TOKEN" ? token : "",
					GITHUB_TOKEN: variable === "GITHUB_TOKEN" ? token : "",
				},
				stdout: "pipe",
				stderr: "pipe",
			});
			const [, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			expect(await readFile(join(root, "config"), "utf8")).toContain(`Authorization: Bearer ${token}`);
			const argv = await readFile(join(root, "argv"), "utf8");
			expect(argv).not.toContain(token);
			expect(argv).toContain("https://github.com/f5-sales-demo/xcsh/releases/download/v22.4.6/xcsh-darwin-arm64");
			expect(stdout + stderr).not.toContain(token);
			expect(await Bun.file(join(root, "leaked")).exists()).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

for (const [name, token] of [
	["space", "synthetic token"],
	["tab", "synthetic\ttoken"],
	["newline", "synthetic\nheader = injected"],
	["carriage return", "synthetic\rtoken"],
	["control character", "synthetic\u0001token"],
	["double quote", 'synthetic"token'],
	["single quote", "synthetic'token"],
	["backslash", "synthetic\\token"],
	["non bearer punctuation", "synthetic!token"],
	["non ASCII", "syntheticétoken"],
	["leading padding", "=synthetic"],
	["interior padding", "synthetic=token"],
	["only padding", "=="],
])
	it(`rejects ${name} before invoking curl`, async () => {
		const root = await mkdtemp(join(tmpdir(), "xcsh-installer-invalid-auth-"));
		const mocks = join(root, "mocks");
		await mkdir(mocks);
		await writeFile(join(mocks, "uname"), '#!/bin/sh\ncase "$1" in -s) echo Darwin;; -m) echo arm64;; esac\n', {
			mode: 0o755,
		});
		await writeFile(join(mocks, "curl"), '#!/bin/sh\ntouch "$TEST_ROOT/curl-called"\nexit 22\n', { mode: 0o755 });
		try {
			const child = Bun.spawn(["sh", installer, "--binary", "--ref", "v22.4.6"], {
				env: {
					...process.env,
					PATH: `${mocks}:${process.env.PATH}`,
					TEST_ROOT: root,
					PI_INSTALL_DIR: join(root, "install"),
					GH_TOKEN: token,
					GITHUB_TOKEN: "",
				},
				stdout: "pipe",
				stderr: "pipe",
			});
			const [code, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			expect(code).not.toBe(0);
			expect(stderr).toContain("Invalid GitHub API token format");
			expect(stdout + stderr).not.toContain(token);
			expect(await Bun.file(join(root, "curl-called")).exists()).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
