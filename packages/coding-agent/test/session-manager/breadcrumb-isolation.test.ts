import { expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

it("refuses terminal breadcrumbs outside the selected session directory", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-breadcrumb-isolation-"));
	try {
		const source = path.resolve(import.meta.dir, "../../src/session/session-manager.ts");
		const script = `
			import { SessionManager } from ${JSON.stringify(source)};
			import { getTerminalSessionsDir } from "@f5-sales-demo/pi-utils";
			import * as fs from "node:fs/promises";
			import * as path from "node:path";
			const root = process.argv[1];
			const cwd = path.join(root, "workspace");
			const dir = path.join(root, "owned-sessions");
			const foreign = path.join(root, "other-agent", "session.jsonl");
			await fs.mkdir(cwd, { recursive: true });
			await fs.mkdir(dir, { recursive: true });
			await fs.mkdir(path.dirname(foreign), { recursive: true });
			const rows = id => JSON.stringify({ type: "session", version: 3, id, cwd, timestamp: "2026-01-01T00:00:00Z" }) + "\\n";
			await fs.writeFile(foreign, rows("foreign"));
			await fs.writeFile(path.join(dir, "owned.jsonl"), rows("owned"));
			await fs.mkdir(getTerminalSessionsDir(), { recursive: true });
			await fs.writeFile(path.join(getTerminalSessionsDir(), "apple-synthetic-isolation"), cwd + "\\n" + foreign + "\\n");
			const manager = await SessionManager.continueRecent(cwd, dir);
			console.log(manager.getSessionId());
			await manager.close();
		`;
		const child = Bun.spawn([process.execPath, "--eval", script, root], {
			cwd: path.resolve(import.meta.dir, "../.."),
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: path.join(root, "agent"),
				TERM_SESSION_ID: "synthetic-isolation",
				KITTY_WINDOW_ID: "",
				TMUX_PANE: "",
				WT_SESSION: "",
			},
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});
		child.stdin.end();
		const [output, errors, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect(code, errors).toBe(0);
		expect(output.trim()).toBe("owned");
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});
