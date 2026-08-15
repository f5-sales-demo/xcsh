import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Args, Command, Flags } from "@f5-sales-demo/pi-utils/cli";
import type { HerdrBindingV1 } from "../herdr/controller";

interface CommandResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

async function execute(command: string[], inherit = false): Promise<CommandResult> {
	const child = Bun.spawn({
		cmd: command,
		stdin: inherit ? "inherit" : "ignore",
		stdout: inherit ? "inherit" : "pipe",
		stderr: inherit ? "inherit" : "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		inherit ? Promise.resolve("") : new Response(child.stdout).text(),
		inherit ? Promise.resolve("") : new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0) throw new Error(stderr.trim() || `${command[0]} exited with ${exitCode}`);
	return { stdout, stderr, exitCode };
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function buildXcshCommand(executable: string, args: string[]): string {
	return [executable, ...args].map(shellQuote).join(" ");
}

export default class Herdr extends Command {
	static description = "Launch xcsh in a conversation-owned Herdr workspace";
	static strict = false;
	static flags = {
		session: Flags.string({ required: true, description: "Herdr named session" }),
		label: Flags.string({ description: "Workspace label" }),
	};
	static args = {
		xcshArgs: Args.string({ required: false, multiple: true, description: "Arguments passed to xcsh after --" }),
	};

	async run(): Promise<void> {
		if (process.env.HERDR_ENV === "1") throw new Error("xcsh herdr must be launched outside an existing Herdr pane");
		const { flags, args } = await this.parse(Herdr);
		const session = flags.session;
		if (!session) throw new Error("--session is required");
		const ownerToken = randomUUID();
		const stateRoot = process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state");
		const bindingDir = path.join(stateRoot, "xcsh", "herdr");
		await fs.mkdir(bindingDir, { recursive: true, mode: 0o700 });
		const bindingPath = path.join(bindingDir, `${session}-${ownerToken}.json`);
		const label = flags.label ?? `xcsh-${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15).toLowerCase()}`;
		const created = await execute([
			"herdr",
			"--session",
			session,
			"workspace",
			"create",
			"--cwd",
			process.cwd(),
			"--label",
			label,
			"--env",
			`XCSH_HERDR_OWNER=${ownerToken}`,
			"--env",
			`XCSH_HERDR_BINDING_PATH=${bindingPath}`,
			"--focus",
		]);
		const response = JSON.parse(created.stdout) as {
			result?: { workspace?: { workspace_id?: string }; root_pane?: { pane_id?: string } };
		};
		const workspaceId = response.result?.workspace?.workspace_id;
		const rootPaneId = response.result?.root_pane?.pane_id;
		if (!workspaceId || !rootPaneId) throw new Error("Herdr returned an invalid workspace creation response");
		const binding: HerdrBindingV1 = {
			version: 1,
			sessionName: session,
			workspaceId,
			rootPaneId,
			ownerToken,
			terminals: [],
		};
		await fs.writeFile(bindingPath, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 });
		await execute([
			"herdr",
			"--session",
			session,
			"workspace",
			"report-metadata",
			workspaceId,
			"--source",
			"xcsh:terminal",
			"--token",
			`xcsh_owner=${ownerToken}`,
		]);
		await execute([
			"herdr",
			"--session",
			session,
			"pane",
			"report-metadata",
			rootPaneId,
			"--source",
			"xcsh:terminal",
			"--token",
			`xcsh_owner=${ownerToken}`,
		]);
		const forwarded = Array.isArray(args.xcshArgs) ? args.xcshArgs : [];
		const xcshCommand = buildXcshCommand(process.env.XCSH_BIN ?? "xcsh", forwarded);
		await execute(["herdr", "--session", session, "pane", "run", rootPaneId, xcshCommand]);
		await execute(["herdr", "session", "attach", session], true);
	}
}

export { buildXcshCommand, shellQuote };
