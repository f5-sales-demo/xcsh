/**
 * SSH Command Controller
 *
 * Handles /ssh subcommands for managing SSH host configurations.
 */
import { getProjectDir, getSSHConfigPath, t } from "@f5-sales-demo/pi-utils";
import { type SSHHost, sshCapability } from "../../capability/ssh";
import { loadCapability } from "../../discovery";
import { addSSHHost, readSSHConfigFile, removeSSHHost, type SSHHostConfig } from "../../ssh/config-writer";
import { shortenPath } from "../../tools/render-utils";
import type { ActionReview } from "../components/reviewed-action";
import { runReviewedAction } from "../components/reviewed-action-dialog";
import { ReportDetailsComponent } from "../components/selector-frame";
import { parseCommandArgs } from "../shared";
import { theme } from "../theme/theme";
import type { InteractiveModeContext } from "../types";

type SSHAddScope = "user" | "project";

export interface SSHCommandDependencies {
	projectDir(): string;
	configPath(scope: SSHAddScope, cwd: string): string;
	readConfig(filePath: string): ReturnType<typeof readSSHConfigFile>;
	addHost(filePath: string, name: string, config: SSHHostConfig): Promise<void>;
	removeHost(filePath: string, name: string): Promise<void>;
	loadHosts(cwd: string): ReturnType<typeof loadCapability<SSHHost>>;
}

const defaultDependencies: SSHCommandDependencies = {
	projectDir: getProjectDir,
	configPath: getSSHConfigPath,
	readConfig: readSSHConfigFile,
	addHost: addSSHHost,
	removeHost: removeSSHHost,
	loadHosts: cwd => loadCapability<SSHHost>(sshCapability.id, { cwd }),
};

interface SSHReviewTarget {
	filePath: string;
	name: string;
	scope: SSHAddScope;
	config: SSHHostConfig;
}

function sshConfigSummary(config: SSHHostConfig): string {
	return [
		config.username ? `${config.username}@${config.host}` : config.host,
		`port ${config.port ?? 22}`,
		config.keyPath ? `key ${config.keyPath}` : "default SSH identity",
		config.compat ? "compatibility mode" : "standard mode",
	].join(" · ");
}

function sshReview(action: "add" | "remove", target: SSHReviewTarget, fileState: unknown): ActionReview {
	const adding = action === "add";
	return {
		identity: `ssh-host:${target.scope}:${target.name}`,
		scope: `${target.scope === "user" ? "User" : "Project"} SSH configuration · ${target.filePath}`,
		revision: JSON.stringify({ action, fileState, target }),
		changes: [
			{
				field: "Saved host",
				before: adding ? "Absent" : sshConfigSummary(target.config),
				after: adding ? sshConfigSummary(target.config) : "Removed",
			},
			...(target.config.description
				? [
						{
							field: "Description",
							before: adding ? "Absent" : target.config.description,
							after: adding ? target.config.description : "Removed",
						},
					]
				: []),
		],
		consequence: adding
			? "Writes the named host to the selected configuration scope. This saves configuration only; it does not test connectivity, authenticate, or open a remote connection."
			: "Removes only this saved host from the selected configuration scope. Existing processes or connections are not terminated.",
	};
}

export class SSHCommandController {
	private readonly dependencies: SSHCommandDependencies;
	constructor(
		private ctx: InteractiveModeContext,
		dependencies: Partial<SSHCommandDependencies> = {},
	) {
		this.dependencies = { ...defaultDependencies, ...dependencies };
	}

	/**
	 * Handle /ssh command and route to subcommands
	 */
	async handle(text: string): Promise<void> {
		const parts = text.trim().split(/\s+/);
		const subcommand = parts[1]?.toLowerCase();

		if (!subcommand || subcommand === "help") {
			await this.#showHelp();
			return;
		}

		switch (subcommand) {
			case "add":
				await this.#handleAdd(text);
				break;
			case "list":
				await this.#handleList();
				break;
			case "remove":
			case "rm":
				await this.#handleRemove(text);
				break;
			default:
				this.ctx.showError(t("ssh.controller.unknownSubcommand", { subcommand: subcommand! }));
		}
	}

	/**
	 * Show help text
	 */
	async #showHelp(): Promise<void> {
		const helpText = [
			"",
			theme.bold("SSH Host Management"),
			"",
			"Manage SSH host configurations for remote command execution.",
			"",
			theme.fg("contentAccent", "Commands:"),
			"  /ssh add <name> --host <host> [--user <user>] [--port <port>] [--key <keyPath>] [--desc <description>] [--compat] [--scope project|user]",
			"  /ssh list             List all configured SSH hosts",
			"  /ssh remove <name> [--scope project|user]    Remove an SSH host (default: project)",
			"  /ssh help             Show this help message",
			"",
		].join("\n");

		await this.#showReport("SSH host management", "Commands and saved-configuration behavior", helpText);
	}

	/**
	 * Handle /ssh add - parse flags and add host to config
	 */
	async #handleAdd(text: string): Promise<void> {
		const prefixMatch = text.match(/^\/ssh\s+add\b\s*(.*)$/i);
		const rest = prefixMatch?.[1]?.trim() ?? "";
		if (!rest) {
			this.ctx.showError(t("ssh.add.usage"));
			return;
		}

		const tokens = parseCommandArgs(rest);
		if (tokens.length === 0) {
			this.ctx.showError(t("ssh.add.usage"));
			return;
		}

		let name: string | undefined;
		let scope: SSHAddScope = "project";
		let host: string | undefined;
		let username: string | undefined;
		let port: number | undefined;
		let keyPath: string | undefined;
		let description: string | undefined;
		let compat = false;

		let i = 0;
		if (!tokens[0].startsWith("-")) {
			name = tokens[0];
			i = 1;
		}

		while (i < tokens.length) {
			const argToken = tokens[i];
			if (argToken === "--host") {
				const value = tokens[i + 1];
				if (!value) {
					this.ctx.showError(t("ssh.add.missingHost"));
					return;
				}
				host = value;
				i += 2;
				continue;
			}
			if (argToken === "--user") {
				const value = tokens[i + 1];
				if (!value) {
					this.ctx.showError(t("ssh.add.missingUser"));
					return;
				}
				username = value;
				i += 2;
				continue;
			}
			if (argToken === "--port") {
				const value = tokens[i + 1];
				if (!value) {
					this.ctx.showError(t("ssh.add.missingPort"));
					return;
				}
				const parsed = Number.parseInt(value, 10);
				if (Number.isNaN(parsed) || parsed < 1 || parsed > 65535) {
					this.ctx.showError(t("ssh.add.invalidPort"));
					return;
				}
				port = parsed;
				i += 2;
				continue;
			}
			if (argToken === "--key") {
				const value = tokens[i + 1];
				if (!value) {
					this.ctx.showError(t("ssh.add.missingKey"));
					return;
				}
				keyPath = value;
				i += 2;
				continue;
			}
			if (argToken === "--desc") {
				const value = tokens[i + 1];
				if (!value) {
					this.ctx.showError(t("ssh.add.missingDesc"));
					return;
				}
				description = value;
				i += 2;
				continue;
			}
			if (argToken === "--compat") {
				compat = true;
				i += 1;
				continue;
			}
			if (argToken === "--scope") {
				const value = tokens[i + 1];
				if (!value || (value !== "project" && value !== "user")) {
					this.ctx.showError(t("ssh.add.invalidScope"));
					return;
				}
				scope = value;
				i += 2;
				continue;
			}
			this.ctx.showError(t("ssh.add.unknownOption", { option: argToken }));
			return;
		}

		if (!name) {
			this.ctx.showError(t("ssh.add.nameRequired"));
			return;
		}

		if (!host) {
			this.ctx.showError(t("ssh.add.hostRequired"));
			return;
		}

		try {
			const hostConfig: SSHHostConfig = { host };
			if (username) hostConfig.username = username;
			if (port) hostConfig.port = port;
			if (keyPath) hostConfig.keyPath = keyPath;
			if (description) hostConfig.description = description;
			if (compat) hostConfig.compat = true;
			const prepare = async (): Promise<{ review: ActionReview; target: SSHReviewTarget }> => {
				const filePath = this.dependencies.configPath(scope, this.dependencies.projectDir());
				const current = await this.dependencies.readConfig(filePath);
				if (current.hosts?.[name]) throw new Error(`SSH host "${name}" already exists in ${scope} scope.`);
				const target = { filePath, name, scope, config: hostConfig };
				return { review: sshReview("add", target, current), target };
			};
			const prepared = await prepare();
			const outcome = await runReviewedAction(this.ctx, "SSH host addition", {
				review: prepared.review,
				resolve: prepare,
				execute: async target => this.dependencies.addHost(target.filePath, target.name, target.config),
			});
			if (outcome === "busy") this.ctx.showStatus("Another reviewed action is already open.");
			else if (outcome === "succeeded")
				this.ctx.showStatus(`Saved SSH host "${name}" in ${scope} configuration. Connectivity was not tested.`);
			else if (outcome === "unresolved")
				this.ctx.showError(`SSH host addition for "${name}" remains unresolved. Reopen the command to retry.`);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);

			let helpText = "";
			if (errorMsg.includes("already exists")) {
				helpText = `\n\nTip: Use ${theme.fg("contentAccent", "/ssh remove")} first, or choose a different name.`;
			}

			this.ctx.showError(t("ssh.add.failed", { message: errorMsg + helpText }));
		}
	}

	/**
	 * Handle /ssh list - show all configured SSH hosts
	 */
	async #handleList(): Promise<void> {
		try {
			const cwd = this.dependencies.projectDir();

			// Load from both user and project configs
			const userPath = this.dependencies.configPath("user", cwd);
			const projectPath = this.dependencies.configPath("project", cwd);

			const [userConfig, projectConfig] = await Promise.all([
				this.dependencies.readConfig(userPath),
				this.dependencies.readConfig(projectPath),
			]);

			const userHosts = Object.keys(userConfig.hosts ?? {});
			const projectHosts = Object.keys(projectConfig.hosts ?? {});

			// Load discovered hosts via capability system
			const configHostNames = new Set([...userHosts, ...projectHosts]);
			let discoveredHosts: SSHHost[] = [];
			try {
				const result = await this.dependencies.loadHosts(cwd);
				discoveredHosts = result.items.filter(h => !configHostNames.has(h.name));
			} catch {
				// Ignore discovery errors
			}

			if (userHosts.length === 0 && projectHosts.length === 0 && discoveredHosts.length === 0) {
				await this.#showReport(
					t("ssh.list.title"),
					"Saved and discovered SSH hosts",
					[
						theme.fg("muted", t("ssh.list.noneConfigured")),
						`Use ${theme.fg("contentAccent", "/ssh add")} to add a host.`,
					].join("\n"),
				);
				return;
			}

			const lines: string[] = ["", theme.bold(t("ssh.list.title")), ""];

			// Show user-level hosts
			if (userHosts.length > 0) {
				lines.push(
					theme.fg("contentAccent", t("ssh.list.userLevel")) + theme.fg("muted", ` (~/.xcsh/agent/ssh.json):`),
				);
				for (const name of userHosts) {
					const config = userConfig.hosts![name];
					const details = this.#formatHostDetails(config);
					lines.push(`  ${theme.fg("contentAccent", name)} ${details}`);
				}
				lines.push("");
			}

			// Show project-level hosts
			if (projectHosts.length > 0) {
				lines.push(theme.fg("contentAccent", t("ssh.list.projectLevel")) + theme.fg("muted", ` (.xcsh/ssh.json):`));
				for (const name of projectHosts) {
					const config = projectConfig.hosts![name];
					const details = this.#formatHostDetails(config);
					lines.push(`  ${theme.fg("contentAccent", name)} ${details}`);
				}
				lines.push("");
			}

			// Show discovered hosts (from ssh.json, .ssh.json in project root, etc.)
			if (discoveredHosts.length > 0) {
				// Group by source
				const bySource = new Map<string, SSHHost[]>();
				for (const host of discoveredHosts) {
					const key = `${host._source.providerName}|${host._source.path}`;
					let group = bySource.get(key);
					if (!group) {
						group = [];
						bySource.set(key, group);
					}
					group.push(host);
				}

				for (const [key, hosts] of bySource) {
					const sepIdx = key.indexOf("|");
					const providerName = key.slice(0, sepIdx);
					const sourcePath = key.slice(sepIdx + 1);
					const shortPath = shortenPath(sourcePath);
					lines.push(
						theme.fg("contentAccent", t("ssh.list.discovered")) +
							theme.fg("muted", ` (${providerName}: ${shortPath}):`) +
							theme.fg("dim", ` ${t("ssh.list.readOnly")}`),
					);
					for (const host of hosts) {
						const details = this.#formatHostDetails({
							host: host.host,
							username: host.username,
							port: host.port,
						});
						lines.push(`  ${theme.fg("contentAccent", host.name)} ${details}`);
					}
					lines.push("");
				}
			}

			await this.#showReport(t("ssh.list.title"), "Saved scope, source, and connection target", lines.join("\n"));
		} catch (error) {
			this.ctx.showError(t("ssh.list.failed", { message: error instanceof Error ? error.message : String(error) }));
		}
	}

	/**
	 * Format host details (host, user, port) for display
	 */
	#formatHostDetails(config: { host?: string; username?: string; port?: number }): string {
		const parts: string[] = [];
		if (config.host) parts.push(config.host);
		if (config.username) parts.push(`user=${config.username}`);
		if (config.port && config.port !== 22) parts.push(`port=${config.port}`);
		return theme.fg("dim", parts.length > 0 ? `[${parts.join(", ")}]` : "");
	}

	/**
	 * Handle /ssh remove <name> - remove a host from config
	 */
	async #handleRemove(text: string): Promise<void> {
		const match = text.match(/^\/ssh\s+(?:remove|rm)\b\s*(.*)$/i);
		const rest = match?.[1]?.trim() ?? "";
		const tokens = parseCommandArgs(rest);

		let name: string | undefined;
		let scope: "project" | "user" = "project";
		let i = 0;

		if (tokens.length > 0 && !tokens[0].startsWith("-")) {
			name = tokens[0];
			i = 1;
		}

		while (i < tokens.length) {
			const token = tokens[i];
			if (token === "--scope") {
				const value = tokens[i + 1];
				if (!value || (value !== "project" && value !== "user")) {
					this.ctx.showError(t("ssh.remove.invalidScope"));
					return;
				}
				scope = value;
				i += 2;
				continue;
			}
			this.ctx.showError(t("ssh.remove.unknownOption", { option: token }));
			return;
		}

		if (!name) {
			this.ctx.showError(t("ssh.remove.nameRequired"));
			return;
		}

		try {
			const prepare = async (): Promise<{ review: ActionReview; target: SSHReviewTarget }> => {
				const filePath = this.dependencies.configPath(scope, this.dependencies.projectDir());
				const current = await this.dependencies.readConfig(filePath);
				const host = current.hosts?.[name];
				if (!host) throw new Error(t("ssh.remove.notFound", { name, scope }));
				const target = { filePath, name, scope, config: host };
				return { review: sshReview("remove", target, current), target };
			};
			const prepared = await prepare();
			const outcome = await runReviewedAction(this.ctx, "SSH host removal", {
				review: prepared.review,
				resolve: prepare,
				execute: async target => this.dependencies.removeHost(target.filePath, target.name),
			});
			if (outcome === "busy") this.ctx.showStatus("Another reviewed action is already open.");
			else if (outcome === "succeeded")
				this.ctx.showStatus(`Removed SSH host "${name}" from ${scope} configuration.`);
			else if (outcome === "unresolved")
				this.ctx.showError(`SSH host removal for "${name}" remains unresolved. Reopen the command to retry.`);
		} catch (error) {
			this.ctx.showError(
				t("ssh.remove.failed", { message: error instanceof Error ? error.message : String(error) }),
			);
		}
	}

	/**
	 * Show a message in the chat
	 */
	async #showReport(title: string, purpose: string, text: string): Promise<void> {
		await this.ctx.showHookCustom<void>(
			(ui, _theme, _keys, done) =>
				new ReportDetailsComponent(
					title,
					purpose,
					text.trim(),
					() => done(),
					() => ui.terminal.rows,
				),
		);
	}
}
