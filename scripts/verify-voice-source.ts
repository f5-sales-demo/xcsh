import { voiceBuildEnvironment } from "./voice-build-environment";

/** Generated packages are separate from the immutable source checked out for qualification. */
export async function verifyVoiceSource(
	repo: string,
	source: string,
	environment: Record<string, string | undefined> = Bun.env,
): Promise<void> {
	if (!/^[0-9a-f]{40}$/.test(source)) throw new Error("An explicit source revision is required");
	async function git(args: string[]): Promise<string> {
		const child = Bun.spawn(["git", ...args], {
			cwd: repo, env: voiceBuildEnvironment(environment, "source-check"), stdout: "pipe", stderr: "pipe",
		});
		const deadline = setTimeout(() => child.kill(), 10_000);
		try {
			const [code, stdout] = await Promise.all([
				child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
			]);
			if (code !== 0) throw new Error("Cannot verify the qualification source");
			return stdout;
		} finally { clearTimeout(deadline); }
	}
	if ((await git(["rev-parse", "HEAD"])).trim() !== source)
		throw new Error("Qualification source does not match the checkout");
	const status = await git([
		"status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ".",
		":(exclude)voice-qualified-artifacts", ":(exclude)packages/coding-agent/binaries",
		":(exclude)packages/coding-agent/src/internal-urls/.documentation-generated/documentation-index.sqlite.gz",
		":(exclude)packages/coding-agent/src/internal-urls/.documentation-generated/terraform/terraform-documentation.sqlite.gz",
	]);
	if (status.length) throw new Error("A clean committed source tree is required for qualification");
}
