import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

async function bounded<T>(promise: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout>;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error("Isolated clipboard fixture timed out")), 5000);
			}),
		]);
	} finally {
		clearTimeout(timer!);
	}
}

async function firstLine(stream: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stream.getReader();
	let text = "";
	try {
		while (!text.includes("\n")) {
			const chunk = await reader.read();
			if (chunk.done) throw new Error("Fixture exited without a receipt");
			text += new TextDecoder().decode(chunk.value);
		}
		return text.split("\n")[0];
	} finally {
		reader.releaseLock();
	}
}

test.skipIf(process.platform !== "linux" || !Bun.which("Xvfb") || !Bun.which("xclip"))(
	"native clipboard content is independently readable while its process is alive on isolated X11",
	async () => {
		const root = await mkdtemp(join(tmpdir(), "xcsh-clipboard-x11-"));
		const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8", TMPDIR: root };
		const server = Bun.spawn(["Xvfb", "-displayfd", "1", "-nolisten", "tcp", "-screen", "0", "640x480x24"], {
			env,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		let writer: Pick<ReturnType<typeof Bun.spawn>, "kill" | "exited"> | undefined;
		let reader: typeof server | undefined;
		try {
			const display = await bounded(firstLine(server.stdout));
			if (!/^\d+$/.test(display)) throw new Error("Xvfb did not allocate a disposable display");
			const isolated = { ...env, DISPLAY: `:${display}` };
			const module = resolve(import.meta.dir, "../../src/utils/clipboard.ts");
			const content = "Synthetic isolated clipboard persistence · π 🚀\nSecond line";
			const copyProcess = Bun.spawn(
				[
					process.execPath,
					"-e",
					`import {copyToClipboardWithDelivery} from ${JSON.stringify(module)};const results=[];for(const text of ["Earlier synthetic clipboard text",${JSON.stringify(content)}])results.push(await copyToClipboardWithDelivery(text));console.log(JSON.stringify(results));await new Promise(resolve=>process.stdin.once("data",resolve));`,
				],
				{ cwd: root, env: isolated, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
			);
			writer = copyProcess;
			expect(JSON.parse(await bounded(firstLine(copyProcess.stdout)))).toEqual([
				{ ok: true, delivery: "copied" },
				{ ok: true, delivery: "copied" },
			]);
			reader = Bun.spawn(["xclip", "-selection", "clipboard", "-out"], {
				cwd: root,
				env: isolated,
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			});
			const [exit, copied, error] = await bounded(
				Promise.all([reader.exited, new Response(reader.stdout).text(), new Response(reader.stderr).text()]),
			);
			expect({ exit, error }).toEqual({ exit: 0, error: "" });
			expect(copied).toBe(content);
			copyProcess.stdin.write("exit\n");
			copyProcess.stdin.end();
			expect(await bounded(copyProcess.exited)).toBe(0);
		} finally {
			for (const child of [reader, writer, server])
				if (child) {
					child.kill();
					await child.exited;
				}
			await rm(root, { recursive: true, force: true });
		}
	},
	15000,
);
