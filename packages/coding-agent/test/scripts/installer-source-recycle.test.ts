import { expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const installer = resolve(import.meta.dir, "../../../../scripts/install.sh");

for (const withRef of [false, true])
	for (const noRecycle of [false, true])
		it(`source recycle targets the installed executable: ref=${withRef}, optOut=${noRecycle}`, async () => {
			const root = await mkdtemp(join(tmpdir(), "xcsh-source-recycle-"));
			const mocks = join(root, "mocks");
			const install = join(root, "install with spaces");
			await mkdir(mocks);
			const installed = '#!/bin/sh\nprintf "%s %s\\n" "$1" "$2" >> "$TEST_ROOT/installed-calls"\n';
			await writeFile(join(root, "installed-template"), installed);
			await writeFile(join(mocks, "xcsh"), '#!/bin/sh\ntouch "$TEST_ROOT/foreign-called"\nexit 23\n', {
				mode: 0o755,
			});
			await writeFile(join(mocks, "uname"), '#!/bin/sh\ncase "$1" in -s) echo Linux;; -m) echo x86_64;; esac\n', {
				mode: 0o755,
			});
			await writeFile(join(mocks, "git-lfs"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
			await writeFile(
				join(mocks, "git"),
				`#!/bin/sh
if [ "$1" = -C ]; then target="$2"; shift 2; else exit 0; fi
case "$1" in
checkout)
 mkdir -p "$target/packages/coding-agent" "$target/packages/natives/native" "$target/node_modules/.bun/synthetic"
 for kind in modern baseline; do printf 'synthetic native' > "$target/node_modules/.bun/synthetic/pi_natives.linux-x64-$kind.node"; done;;
esac
`,
				{ mode: 0o755 },
			);
			await writeFile(
				join(mocks, "bun"),
				`#!/bin/sh
case "$1" in
--version) echo 1.4.5;;
pm) [ "$2" = bin ] && [ "$3" = -g ] || exit 29; printf '%s\\n' "$TEST_ROOT/package bin";;
install)
 if [ "$2" = -g ]; then mkdir -p "$TEST_ROOT/package bin"; cp "$TEST_ROOT/installed-template" "$TEST_ROOT/package bin/xcsh"; chmod 0755 "$TEST_ROOT/package bin/xcsh"; fi;;
--cwd=packages/coding-agent)
 mkdir -p packages/coding-agent/dist
 cp "$TEST_ROOT/installed-template" packages/coding-agent/dist/xcsh;;
*) exit 29;;
esac
`,
				{ mode: 0o755 },
			);
			try {
				const child = Bun.spawn(
					[
						"sh",
						installer,
						"--source",
						...(withRef ? ["--ref", "synthetic-ref"] : []),
						...(noRecycle ? ["--no-recycle"] : []),
					],
					{
						env: {
							...process.env,
							PATH: `${mocks}:${process.env.PATH}`,
							TEST_ROOT: root,
							PI_INSTALL_DIR: install,
							GH_TOKEN: "",
							GITHUB_TOKEN: "",
						},
						stdout: "pipe",
						stderr: "pipe",
					},
				);
				const [code, stdout, stderr] = await Promise.all([
					child.exited,
					new Response(child.stdout).text(),
					new Response(child.stderr).text(),
				]);
				expect(code, `${stdout}\n${stderr}`).toBe(0);
				expect(await Bun.file(join(withRef ? install : join(root, "package bin"), "xcsh")).exists()).toBe(true);
				expect(await Bun.file(join(root, "foreign-called")).exists()).toBe(false);
				if (noRecycle) expect(await Bun.file(join(root, "installed-calls")).exists()).toBe(false);
				else expect(await readFile(join(root, "installed-calls"), "utf8")).toBe("chrome recycle\noffice recycle\n");
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		});
