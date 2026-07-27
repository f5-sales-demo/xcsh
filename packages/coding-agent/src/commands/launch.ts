/**
 * Root command for the coding agent CLI.
 */

import { APP_NAME } from "@f5-sales-demo/pi-utils";
import { Args, Command } from "@f5-sales-demo/pi-utils/cli";
import { parseArgs } from "../cli/args";
import { buildCliFlags } from "../cli/flag-spec";
import { runRootCommand } from "../main";

export default class Index extends Command {
	static description = "AI coding assistant";
	static hidden = true;

	static args = {
		messages: Args.string({
			description: "Messages to send (prefix files with @)",
			required: false,
			multiple: true,
		}),
	};

	static flags = buildCliFlags();

	static examples = [
		`# Interactive mode\n  ${APP_NAME}`,
		`# Interactive mode with initial prompt\n  ${APP_NAME} "List all .ts files in src/"`,
		`# Include files in initial message\n  ${APP_NAME} @prompt.md @image.png "What color is the sky?"`,
		`# Non-interactive mode (process and exit)\n  ${APP_NAME} -p "List all .ts files in src/"`,
		`# Continue previous session\n  ${APP_NAME} --continue "What did we discuss?"`,
		`# Use different model (fuzzy matching)\n  ${APP_NAME} --model opus "Help me refactor this code"`,
		`# Limit model cycling to specific models\n  ${APP_NAME} --models claude-sonnet,claude-haiku,gpt-4o`,
		`# Export a session file to HTML\n  ${APP_NAME} --export ~/.xcsh/agent/sessions/--path--/session.jsonl`,
	];

	static strict = false;

	async run(): Promise<void> {
		const parsed = parseArgs(this.argv);
		await runRootCommand(parsed, this.argv);
	}
}
