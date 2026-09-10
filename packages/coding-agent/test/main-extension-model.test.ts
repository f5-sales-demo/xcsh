import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.each([
	{ selection: ["--model", "cli-fixture/model"] },
	{ selection: ["--provider", "cli-fixture", "--model", "model"] },
])(
	"explicit extension model launches with discovery disabled: %j",
	async ({ selection }) => {
		const dir = await mkdtemp(join(tmpdir(), "xcsh-extension-model-"));
		try {
			const extension = join(dir, "provider.ts");
			await Bun.write(
				extension,
				`
export default function (pi) {
 pi.registerProvider("cli-fixture", {
  baseUrl: "http://127.0.0.1/unused", apiKey: "fixture-key", api: "cli-fixture",
  models: [{ id: "model", name: "CLI fixture", reasoning: false, input: ["text"],
   cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1024 }],
  streamSimple(model) {
   const message = { role: "assistant", content: [{ type: "text", text: "EXTENSION-MODEL" }],
    api: model.api, provider: model.provider, model: model.id, stopReason: "stop", timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
     cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
   return { async *[Symbol.asyncIterator]() { yield { type: "done", reason: "stop", message }; },
    result: () => Promise.resolve(message) };
  }
 });
}
`,
			);
			const child = Bun.spawn(
				[
					process.execPath,
					join(import.meta.dir, "../src/cli.ts"),
					"--no-extensions",
					"--extension",
					extension,
					"--no-tools",
					"--no-mcp",
					"--no-lsp",
					"--no-memories",
					"--no-skills",
					"--no-session",
					...selection,
					"--print",
					"Fixture response",
				],
				{
					cwd: dir,
					env: { ...process.env, PI_CODING_AGENT_DIR: join(dir, "agent") },
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const deadline = setTimeout(() => child.kill(), 15000);
			try {
				const [stdout, stderr, code] = await Promise.all([
					new Response(child.stdout).text(),
					new Response(child.stderr).text(),
					child.exited,
				]);
				expect({ code, stderr }).toMatchObject({ code: 0 });
				expect(stdout).toContain("EXTENSION-MODEL");
			} finally {
				clearTimeout(deadline);
				if (child.exitCode === null) child.kill();
				await child.exited;
			}
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
	20000,
);
