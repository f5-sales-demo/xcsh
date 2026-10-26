import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { prepareVoiceRuntime } from "./prepare-voice-runtime";
import { voiceBuildEnvironment } from "./voice-build-environment";
const repo = resolve(import.meta.dir, "..");
const source =
	Bun.env.GITHUB_SHA ??
	(await new Response(Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe" }).stdout).text()).trim();
if (!/^[0-9a-f]{40}$/.test(source)) throw new Error("Source identity is required");
const native = await prepareVoiceRuntime(repo);
const target = `${process.arch === "arm64" ? "aarch64" : "x86_64"}-${process.platform === "darwin" ? "apple-darwin" : "unknown-linux-gnu"}`;
const evidence = join(
	repo,
	"node_modules/.cache/voice-qualification",
	source,
	target,
	`attempt-${Date.now()}-${process.pid}`,
);
await mkdir(evidence, { recursive: true });
const environment = { ...Bun.env, ...native.environment, STABLE_GIT_COMMIT: source };
async function run(args: string[], name: string): Promise<void> {
	const child = Bun.spawn(args, {
		cwd: repo,
		env: voiceBuildEnvironment(environment, name),
		stdout: Bun.file(join(evidence, `${name}.private.log`)),
		stderr: Bun.file(join(evidence, `${name}.stderr.private.log`)),
	});
	if ((await child.exited) !== 0) {
		// Build-only diagnostics contain no provider session or audio capture.
		// Preserve complete logs privately; expose a bounded compiler finding in CI.
		if (["native-addon", "release-helper", "application"].includes(name)) {
			const diagnostics = await Bun.file(join(evidence, `${name}.stderr.private.log`)).text();
			console.error(diagnostics.split("\n").slice(-24).join("\n"));
		}
		throw new Error(`Native qualification failed: ${name}`);
	}
}
await run(
	[
		"bun",
		"test",
		"scripts/assemble-voice-package.test.ts",
		"scripts/verify-voice-package.test.ts",
		"scripts/application-build-defines.test.ts",
		"scripts/voice-build-environment.test.ts",
	],
	"assembly-rejections",
);
await run(["cargo", "test", "-p", "xcsh-realtime-webrtc"], "controller");
await run(["cargo", "test", "-p", "xcsh-voice-host"], "helper");
await run(["cargo", "test", "-p", "xcsh-voice-host", "--test", "packaged_runtime", "--", "--ignored"], "relocation");
await run(["cargo", "test", "-p", "xcsh-voice-host", "--test", "installed_client"], "installed-client");
await run(["cargo", "build", "--release", "-p", "xcsh-voice-host"], "release-helper");
await run(["bun", "scripts/ensure-dev-native.ts"], "native-addon");
await run(["bun", "scripts/generate-voice-companion.ts", "--check"], "companion-source");
await run(
	[
		"bun",
		"scripts/ci-release-build-binaries.ts",
		"--voice-qualification",
		"--platform",
		process.platform,
		"--arch",
		process.arch,
	],
	"application",
);
const output = join(repo, "voice-qualified-artifacts", `${source}-${target}`);
await run(
	[
		"bun",
		"scripts/assemble-voice-package.ts",
		"--helper",
		join(repo, "target/release/codex-voice-host"),
		"--runtime",
		join(native.root, "runtime"),
		"--app",
		join(repo, "packages/coding-agent/binaries", `xcsh-${process.platform}-${process.arch}`),
		"--source",
		source,
		"--output",
		output,
	],
	"assembly",
);
await run(
	[
		"bun",
		"scripts/verify-voice-package.ts",
		"--package",
		output,
		"--source",
		source,
		"--evidence",
		join(evidence, "package-handshake-capture"),
	],
	"package-handshake",
);
await Bun.write(
	join(output, "native-verification.json"),
	await Bun.file(join(evidence, "package-handshake-capture/receipt.json")).text(),
);
console.log(JSON.stringify({ source, target, output, packagingChecks: "passed", physicalAcceptance: "untested" }));
