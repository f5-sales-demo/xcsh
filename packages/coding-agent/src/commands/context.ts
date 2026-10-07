import * as fs from "node:fs";
import { getProjectDir, getXCSHConfigDir } from "@f5-sales-demo/pi-utils";
import { Args, CliUsageError, Command, Flags } from "@f5-sales-demo/pi-utils/cli";
import { Settings } from "../config/settings";
import { CONTEXT_ACTIONS, type ContextAction, executeContextOperation } from "../services/context-operations";
import { ContextError, ContextService } from "../services/xcsh-context";

export default class Context extends Command {
	static description = "Manage saved F5 XC contexts without menus or model inference";
	static args = {
		action: Args.string({ options: CONTEXT_ACTIONS }),
		target: Args.string({ description: "Explicit context name (import: file or - for stdin)" }),
		value: Args.string({ description: "Create URL, rename name, link global name, or environment action" }),
		values: Args.string({ multiple: true, description: "Environment assignments or names" }),
	};
	static flags = {
		json: Flags.boolean({ description: "Emit structured JSON" }),
		source: Flags.string({ options: ["local", "global"], default: "global" }),
		url: Flags.string({ description: "Replacement HTTPS tenant endpoint" }),
		namespace: Flags.string({ description: "Saved default namespace" }),
		"token-stdin": Flags.boolean({ description: "Read a replacement API token from stdin" }),
		confirm: Flags.boolean({ description: "Required for deletion" }),
		overwrite: Flags.boolean({ description: "Replace conflicting global contexts during import" }),
		"include-token": Flags.boolean({ description: "Explicitly include secrets in exported bundle" }),
	};
	async run(): Promise<void> {
		const { args, flags } = await this.parse(Context);
		const action = (args.action ?? "list") as ContextAction;
		const target = args.target ? { name: args.target, source: flags.source as "local" | "global" } : undefined;
		if (!["list", "import", "export"].includes(action) && !target)
			throw new CliUsageError(`context ${action} requires a target`);
		if (action === "create" && (!(args.value ?? flags.url) || !flags["token-stdin"]))
			throw new CliUsageError("context create requires NAME URL --token-stdin");
		if (action === "edit" && !flags.url && !flags["token-stdin"] && flags.namespace === undefined)
			throw new CliUsageError("context edit requires --url, --namespace or --token-stdin");
		if ((action === "rename" || action === "link") && !args.value)
			throw new CliUsageError(`context ${action} requires a second name`);
		if (action === "delete" && !flags.confirm) throw new CliUsageError("context delete requires --confirm");
		if (action === "import" && !args.target) throw new CliUsageError("context import requires FILE or -");
		if (flags["token-stdin"] && !["create", "edit"].includes(action))
			throw new CliUsageError("--token-stdin applies only to create/edit");
		if (flags["include-token"] && action !== "export")
			throw new CliUsageError("--include-token applies only to export");
		if (flags.overwrite && action !== "import") throw new CliUsageError("--overwrite applies only to import");
		if (args.values?.length && action !== "env") throw new CliUsageError("Unexpected arguments");
		if (args.value && !["create", "rename", "link", "env"].includes(action))
			throw new CliUsageError("Unexpected argument");
		let env: Record<string, string> | undefined;
		let unset: string[] | undefined;
		if (action === "env" && args.value) {
			if (args.value === "set") {
				if (!args.values?.length) throw new CliUsageError("context env NAME set requires KEY=VALUE");
				env = {};
				for (const assignment of args.values) {
					const index = assignment.indexOf("=");
					if (index < 1) throw new CliUsageError("Expected KEY=VALUE");
					env[assignment.slice(0, index)] = assignment.slice(index + 1);
				}
			} else if (args.value === "unset") {
				if (!args.values?.length) throw new CliUsageError("context env NAME unset requires keys");
				unset = args.values;
			} else if (args.value !== "list") throw new CliUsageError("context env action must be list, set or unset");
		}
		try {
			let bundle: unknown;
			if (action === "import") {
				const bytes =
					args.target === "-"
						? await new Response(Bun.stdin.stream()).text()
						: fs.readFileSync(args.target!, "utf8");
				try {
					bundle = JSON.parse(bytes);
				} catch {
					throw new Error("Import must contain valid JSON.");
				}
			}
			const apiToken = flags["token-stdin"]
				? (await new Response(Bun.stdin.stream()).text()).replace(/\r?\n$/, "")
				: undefined;
			if (apiToken !== undefined && (!apiToken || /[\r\n]/.test(apiToken)))
				throw new CliUsageError("Token stdin must contain one non-empty line.");
			await Settings.init({ cwd: getProjectDir(), inMemory: true });
			const service = ContextService.init(getXCSHConfigDir());
			const result = await executeContextOperation(
				service,
				{
					action,
					target,
					newName: args.value,
					apiUrl: flags.url ?? (action === "create" ? args.value : undefined),
					apiToken,
					namespace: flags.namespace,
					confirm: flags.confirm,
					includeToken: flags["include-token"],
					overwrite: flags.overwrite,
					bundle,
					env,
					unset,
				},
				getProjectDir(),
			);
			if (result && typeof result === "object" && "status" in result && result.status !== "connected")
				process.exitCode = 1;
			if (flags.json || action === "export") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
			else if (Array.isArray(result))
				for (const choice of result)
					process.stdout.write(
						`${choice.target.name} (${choice.target.source}) · ${choice.context?.apiUrl ?? choice.error}\n`,
					);
			else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		} catch (error) {
			if (error instanceof CliUsageError) throw error;
			process.stderr.write(
				`Error: ${error instanceof ContextError ? error.message : "Context operation failed. Check the target, input and file permissions."}\n`,
			);
			process.exitCode = 1;
		}
	}
}
