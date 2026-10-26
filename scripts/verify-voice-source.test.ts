import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyVoiceSource } from "./verify-voice-source";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-source-"));
	roots.push(root);
	const environment = { ...Bun.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
	async function git(...args: string[]) {
		const child = Bun.spawn(["git", ...args], { cwd: root, env: environment, stdout: "pipe", stderr: "pipe" });
		const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
		if (code !== 0) throw new Error(error);
		return output.trim();
	}
	await git("init", "--quiet");
	await writeFile(join(root, "source.ts"), "export const fixture = 1;\n");
	await git("add", "source.ts");
	await git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "test: initialize source fixture");
	return { root, git, environment, source: await git("rev-parse", "HEAD") };
}
test("a clean source qualifies only at its actual revision", async () => {
	const f = await fixture();
	await verifyVoiceSource(f.root, f.source, f.environment);
	await expect(verifyVoiceSource(f.root, "0".repeat(40), f.environment)).rejects.toThrow("does not match");
});
test.each(["tracked", "staged", "untracked"])("%s source changes cannot acquire an immutable receipt", async state => {
	const f = await fixture();
	await writeFile(join(f.root, state === "untracked" ? "new-source.ts" : "source.ts"), "changed\n");
	if (state === "staged") await f.git("add", "source.ts");
	await expect(verifyVoiceSource(f.root, f.source, f.environment)).rejects.toThrow("clean committed");
});
test("source changes committed during qualification cannot reuse the original revision", async () => {
	const f = await fixture();
	await writeFile(join(f.root, "source.ts"), "changed\n");
	await f.git("add", "source.ts");
	await f.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "test: change source fixture");
	await expect(verifyVoiceSource(f.root, f.source, f.environment)).rejects.toThrow("does not match");
});

test("only the separately verified pinned documentation inputs are outside source status", async () => {
	const f = await fixture();
	const data = join(f.root, "packages/coding-agent/src/internal-urls/.documentation-generated");
	await mkdir(join(data, "terraform"), { recursive: true });
	await writeFile(join(data, "documentation-index.sqlite.gz"), "fixture-pinned-input");
	await writeFile(join(data, "terraform/terraform-documentation.sqlite.gz"), "fixture-pinned-input");
	await verifyVoiceSource(f.root, f.source, f.environment);
	await writeFile(join(data, "unreviewed-source.ts"), "changed");
	await expect(verifyVoiceSource(f.root, f.source, f.environment)).rejects.toThrow("clean committed");
});
