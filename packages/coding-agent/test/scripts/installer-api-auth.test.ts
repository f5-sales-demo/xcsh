import { expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

it("authenticates only GitHub metadata without putting credentials in curl argv", async () => {
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
	const token = "synthetic.jwt-token_~+/==";
	try {
		const child = Bun.spawn(
			["sh", resolve(import.meta.dir, "../../../../scripts/install.sh"), "--binary", "--ref", "v22.4.6"],
			{
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
			},
		);
		await child.exited;
		expect(await readFile(join(root, "config"), "utf8")).toContain(`Authorization: Bearer ${token}`);
		expect(await readFile(join(root, "argv"), "utf8")).not.toContain(token);
		expect(await Bun.file(join(root, "leaked")).exists()).toBe(false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it.each(["synthetic token", 'synthetic"token', "synthetic\ntoken", "synthetic\\token"])(
	"rejects an unsafe API token without exposing it",
	async token => {
		const root = await mkdtemp(join(tmpdir(), "xcsh-installer-invalid-auth-"));
		try {
			const child = Bun.spawn(
				["sh", resolve(import.meta.dir, "../../../../scripts/install.sh"), "--binary", "--ref", "v22.4.6"],
				{
					env: { ...process.env, PI_INSTALL_DIR: join(root, "install"), GH_TOKEN: token },
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const [code, output, error] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			expect(code).not.toBe(0);
			expect(error).toContain("Invalid GitHub API token format");
			expect(output + error).not.toContain(token);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
);
