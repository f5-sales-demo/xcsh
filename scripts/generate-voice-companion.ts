import { createHash } from "node:crypto";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
const input = resolve(root, "packages/chat-ui/src/voice/standalone/companion-entry.ts");
const output = resolve(root, "packages/coding-agent/src/browser/voice-companion.generated.js");
const hash = createHash("sha256");
const sourceRoot = resolve(root, "packages/chat-ui/src");
const files = [...new Bun.Glob("**/*.{ts,tsx,js}").scanSync({ cwd: sourceRoot, onlyFiles: true })].sort();
for (const file of files)
	hash.update(file).update(Buffer.from(await Bun.file(resolve(sourceRoot, file)).arrayBuffer()));

hash.update(Buffer.from(await Bun.file(resolve(root, "bun.lock")).arrayBuffer()));

const signature = `// xcsh voice companion source sha256 ${hash.digest("hex")}\n`;
if (process.argv.includes("--check")) {
	if (!(await Bun.file(output).text()).startsWith(signature))
		throw new Error("Stale voice companion; run bun scripts/generate-voice-companion.ts");
} else {
	const build = await Bun.build({
		entrypoints: [input],
		target: "browser",
		format: "esm",
		minify: true,
		define: { "process.env.NODE_ENV": '"production"' },
	});
	if (!build.success || build.outputs.length !== 1) throw new Error("Voice companion browser build failed");
	await Bun.write(output, signature + (await build.outputs[0]!.text()));
}
