import * as fs from "node:fs";
import { SECRET_ENV_PATTERNS } from "../secrets/index";
import { expandTilde } from "../tools/path-utils";
import {
	deriveTenantFromUrl,
	F5XC_API_TOKEN,
	F5XC_API_URL,
	F5XC_CONSOLE_PASSWORD,
	F5XC_NAMESPACE,
	F5XC_TENANT,
	F5XC_USERNAME,
} from "./f5xc-env";
import { CURRENT_SCHEMA_VERSION, ProfileError, ProfileService } from "./f5xc-profile";
import {
	formatAuthIndicator,
	formatExpiration,
	formatRelativeTime,
	renderF5XCTable,
	type TableRow,
} from "./f5xc-table";

interface CommandContext {
	showStatus(msg: string): void;
	showError(msg: string): void;
	editor: { setText(text: string): void };
	statusLine?: { invalidate(): void };
	updateEditorTopBorder?(): void;
	ui?: { requestRender(): void };
}

export async function handleProfileCommand(
	command: { name: string; args: string; text: string },
	ctx: CommandContext,
): Promise<void> {
	const [sub, ...rest] = command.args.trim().split(/\s+/);
	const arg = rest.join(" ");
	const service = await ProfileService.getOrInit();

	ctx.editor.setText("");

	switch (sub?.toLowerCase()) {
		case "list":
		case undefined:
		case "":
			return handleList(ctx, service);
		case "activate":
			return handleActivate(ctx, service, arg);
		case "validate":
			return handleValidate(ctx, service, arg);
		case "show":
			return handleShow(ctx, service, arg);
		case "status":
			return handleStatus(ctx, service);
		case "create":
			return handleCreate(ctx, service, rest);
		case "delete":
			return handleDelete(ctx, service, rest);
		case "rename":
			return handleRename(ctx, service, rest);
		case "export":
			return handleExport(ctx, service, rest);
		case "import": {
			// Pass the raw args string (everything after the "import" subcommand)
			// rather than the whitespace-tokenized `rest`. Inline JSON values can
			// contain runs of whitespace inside string literals (tabs, multiple
			// spaces) that `command.args.trim().split(/\s+/).join(" ")` would
			// collapse — corrupting the bytes before JSON.parse.
			const rawImportArgs = command.args.trim().replace(/^\S+\s*/, "");
			return handleImport(ctx, service, rawImportArgs);
		}
		case "namespace":
			return handleNamespace(ctx, service, arg);
		case "env":
			return handleEnvSubcommand(ctx, service, rest);
		case "set":
		case "add":
			return handleEnvSet(ctx, service, arg);
		case "unset":
		case "remove":
		case "clear":
			return handleEnvUnset(ctx, service, arg);
		default:
			// Natural language fallback: detect KEY=VALUE patterns
			if (ENV_SET_PATTERN.test(command.args)) {
				return handleEnvSet(ctx, service, command.args);
			}
			ctx.showError(
				`Unknown subcommand: ${sub}. Use /profile list|activate|validate|show|status|create|delete|rename|export|import|namespace|env|set|unset`,
			);
	}
}

/** Strip control characters to prevent TUI corruption from malformed profile JSON */
function sanitize(value: string): string {
	return value.replace(/[\x00-\x1f\x7f]/g, "");
}

/**
 * Split a positional+flag argument list into two groups:
 *   - positionals: args that do not start with "--"
 *   - flags: the set of args that do
 * Unknown flags are preserved in the set — callers check `.has("--name")`
 * and silently ignore anything they don't recognize.
 */
function splitArgs(args: string[]): { positionals: string[]; flags: Set<string> } {
	const positionals: string[] = [];
	const flags = new Set<string>();
	for (const a of args) {
		if (a.startsWith("--")) flags.add(a);
		else positionals.push(a);
	}
	return { positionals, flags };
}

async function handleList(ctx: CommandContext, service: ProfileService): Promise<void> {
	const profiles = await service.listProfiles();
	if (profiles.length === 0) {
		ctx.showStatus("No F5 XC profiles found. Use /profile create or ask me to help set one up.");
		return;
	}
	const status = service.getStatus();
	const lines = profiles.map(p => {
		const marker = p.name === status.activeProfileName ? "*" : " ";
		const versionSuffix =
			p.version !== undefined && p.version > CURRENT_SCHEMA_VERSION ? ` (v${p.version} — upgrade required)` : "";
		return `  ${marker} ${sanitize(p.name).padEnd(20)} ${sanitize(p.apiUrl)}${versionSuffix}`;
	});
	ctx.showStatus(lines.join("\n"));
}

async function handleActivate(ctx: CommandContext, service: ProfileService, name: string): Promise<void> {
	if (!name) {
		ctx.showError("Usage: /profile activate <name>. Run `/profile list` to see available profiles.");
		return;
	}
	try {
		await service.activate(name);
		ctx.statusLine?.invalidate();
		ctx.updateEditorTopBorder?.();
		ctx.ui?.requestRender();
		// Show the same red table as /profile show
		return handleShow(ctx, service);
	} catch (err) {
		ctx.showError(err instanceof ProfileError ? err.message : String(err));
	}
}

function isSensitiveKey(key: string): boolean {
	return SECRET_ENV_PATTERNS.test(key);
}

async function handleShow(ctx: CommandContext, service: ProfileService, name?: string): Promise<void> {
	const targetName = name || service.getStatus().activeProfileName;
	if (!targetName) {
		ctx.showError(
			"No active profile. Run `/profile create <name>` to create one, or `/profile activate <name>` if profiles exist.",
		);
		return;
	}
	const profiles = await service.listProfiles();
	const profile = profiles.find(p => p.name === targetName);
	if (!profile) {
		ctx.showError(`Profile '${targetName}' not found. Run \`/profile list\` to see available profiles.`);
		return;
	}

	// Derive tenant from URL
	const tenant = deriveTenantFromUrl(profile.apiUrl) ?? "";

	// Validate the shown profile's token (not necessarily the active one)
	const auth = await service.validateToken({ timeoutMs: 3000, apiUrl: profile.apiUrl, apiToken: profile.apiToken });

	// Build table rows — auth section first
	const rows: TableRow[] = [
		{ key: F5XC_TENANT, value: sanitize(tenant) },
		{ key: F5XC_API_URL, value: sanitize(profile.apiUrl) },
		{ key: F5XC_API_TOKEN, value: service.maskToken(profile.apiToken) },
	];

	// Auth-related env vars
	const authKeys: string[] = [F5XC_USERNAME, F5XC_CONSOLE_PASSWORD];
	for (const key of authKeys) {
		const value = profile.env?.[key];
		if (value) {
			rows.push({ key: sanitize(key), value: isSensitiveKey(key) ? service.maskToken(value) : sanitize(value) });
		}
	}

	// Auth status indicator
	rows.push({ key: "Status", value: formatAuthIndicator(auth.status, auth.latencyMs, auth.errorClass) });

	// Track where environment section starts
	const envDividerIndex = rows.length;

	// Environment section: namespace + remaining env vars
	rows.push({ key: F5XC_NAMESPACE, value: sanitize(profile.defaultNamespace) });
	if (profile.env) {
		for (const [key, value] of Object.entries(profile.env)) {
			if (authKeys.includes(key)) continue;
			rows.push({ key: sanitize(key), value: isSensitiveKey(key) ? service.maskToken(value) : sanitize(value) });
		}
	}

	// Metadata section (only rendered when at least one field is present)
	const metaRows: TableRow[] = [];
	if (profile.metadata?.createdAt) {
		metaRows.push({ key: "Created", value: formatRelativeTime(profile.metadata.createdAt) });
	}
	if (profile.metadata?.expiresAt) {
		metaRows.push({ key: "Expires", value: formatExpiration(profile.metadata.expiresAt) });
	}
	if (profile.metadata?.lastRotatedAt) {
		metaRows.push({ key: "Last Rotated", value: formatRelativeTime(profile.metadata.lastRotatedAt) });
	}
	if (profile.metadata?.rotateAfterDays) {
		metaRows.push({ key: "Rotation", value: `every ${profile.metadata.rotateAfterDays} days` });
	}

	const dividers: Array<{ before: number; label: string }> = [{ before: envDividerIndex, label: "Environment" }];
	if (metaRows.length > 0) {
		dividers.push({ before: rows.length, label: "Metadata" });
		rows.push(...metaRows);
	}

	ctx.showStatus(renderF5XCTable(profile.name, rows, { dividers }));
}

async function handleValidate(ctx: CommandContext, service: ProfileService, name: string): Promise<void> {
	if (!name) {
		ctx.showError(
			"Missing profile name. Usage: /profile validate <name>. For the active profile, use /profile status.",
		);
		return;
	}
	try {
		const result = await service.validateProfileByName(name);
		const tenant = deriveTenantFromUrl(result.profile.apiUrl) ?? "";
		const rows: TableRow[] = [
			{ key: F5XC_TENANT, value: sanitize(tenant) },
			{ key: F5XC_API_URL, value: sanitize(result.profile.apiUrl) },
			{ key: F5XC_API_TOKEN, value: service.maskToken(result.profile.apiToken) },
			{ key: "Status", value: formatAuthIndicator(result.status, result.latencyMs, result.errorClass) },
		];
		ctx.showStatus(renderF5XCTable(`${result.profile.name} (validation only)`, rows));
	} catch (err) {
		ctx.showError(err instanceof ProfileError ? err.message : String(err));
	}
}

async function handleStatus(ctx: CommandContext, service: ProfileService): Promise<void> {
	const status = service.getStatus();
	if (!status.isConfigured) {
		ctx.showStatus("F5 XC: not configured. Use /profile create or ask me to help set one up.");
		return;
	}
	const auth = await service.validateToken({ timeoutMs: 3000 });
	const rows: TableRow[] = [
		{ key: "Tenant", value: status.activeProfileTenant ?? "(unknown)" },
		{ key: "Source", value: status.credentialSource },
		{ key: "API URL", value: status.activeProfileUrl ?? "(not set)" },
		{ key: "Namespace", value: status.activeProfileNamespace ?? "(not set)" },
		{ key: "Status", value: formatAuthIndicator(auth.status, auth.latencyMs, auth.errorClass) },
	];
	ctx.showStatus(renderF5XCTable(status.activeProfileName ?? "status", rows));
}

async function handleCreate(ctx: CommandContext, service: ProfileService, args: string[]): Promise<void> {
	const [name, url, token, namespace] = args;
	if (!name || !url || !token) {
		ctx.showError("Usage: /profile create <name> <url> <token> [namespace]");
		return;
	}
	if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
		ctx.showError("Profile name must be alphanumeric with dashes/underscores, max 64 chars.");
		return;
	}
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "https:" || !parsed.hostname || parsed.hostname.includes(" ")) {
			ctx.showError("API URL must be a valid HTTPS URL (e.g. https://tenant.console.ves.volterra.io)");
			return;
		}
	} catch {
		ctx.showError("API URL must be a valid HTTPS URL (e.g. https://tenant.console.ves.volterra.io)");
		return;
	}
	try {
		await service.createProfile({
			name,
			apiUrl: url,
			apiToken: token,
			defaultNamespace: namespace ?? "default",
		});
		ctx.showStatus(`Profile '${name}' created. Use /profile activate ${name} to switch to it.`);
	} catch (err) {
		ctx.showError(err instanceof ProfileError ? err.message : String(err));
	}
}

async function handleRename(ctx: CommandContext, service: ProfileService, args: string[]): Promise<void> {
	const [oldName, newName] = args;
	if (!oldName || !newName) {
		ctx.showError("Usage: /profile rename <old> <new>");
		return;
	}
	try {
		await service.renameProfile(oldName, newName);
		ctx.showStatus(`Profile '${oldName}' renamed to '${newName}'.`);
		ctx.statusLine?.invalidate();
		ctx.updateEditorTopBorder?.();
		ctx.ui?.requestRender();
	} catch (err) {
		ctx.showError(err instanceof ProfileError ? err.message : String(err));
	}
}

async function handleExport(ctx: CommandContext, service: ProfileService, args: string[]): Promise<void> {
	const { positionals, flags } = splitArgs(args);
	if (positionals.length > 1) {
		ctx.showError("Usage: /profile export [name] [--include-token]");
		return;
	}
	const includeToken = flags.has("--include-token");
	try {
		const bundle = await service.exportProfiles({
			names: positionals.length === 1 ? [positionals[0]] : undefined,
			includeToken,
		});
		ctx.showStatus(JSON.stringify(bundle, null, 2));
	} catch (err) {
		ctx.showError(err instanceof ProfileError ? err.message : String(err));
	}
}

async function handleImport(ctx: CommandContext, service: ProfileService, rawArgs: string): Promise<void> {
	// Detect --overwrite at the leading or trailing edge of the raw args ONLY.
	// Matching anywhere would falsely strip the literal "--overwrite" that could
	// appear inside a JSON string value (e.g. `{"note":"--overwrite happened"}`).
	// Leading/trailing is the natural CLI usage and leaves the source bytes
	// intact for brace-balanced JSON parsing below.
	let source = rawArgs.trim();
	let overwrite = false;
	if (source.startsWith("--overwrite")) {
		const after = source.slice("--overwrite".length);
		if (after === "" || /^\s/.test(after)) {
			overwrite = true;
			source = after.trimStart();
		}
	}
	if (source.endsWith("--overwrite")) {
		const before = source.slice(0, -"--overwrite".length);
		if (before === "" || /\s$/.test(before)) {
			overwrite = true;
			source = before.trimEnd();
		}
	}
	if (!source) {
		ctx.showError("Usage: /profile import <path-or-json> [--overwrite]");
		return;
	}

	let parsed: unknown;
	if (source.startsWith("{")) {
		// Inline JSON
		try {
			parsed = JSON.parse(source);
		} catch (err) {
			ctx.showError(`Import source is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
			return;
		}
	} else {
		// File path — pass process.env.HOME so tests that mutate HOME are honoured
		const filePath = expandTilde(source, process.env.HOME);
		if (!fs.existsSync(filePath)) {
			ctx.showError(`Import file not found: ${source}`);
			return;
		}
		try {
			const content = fs.readFileSync(filePath, "utf-8");
			parsed = JSON.parse(content);
		} catch (err) {
			ctx.showError(`Import source is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
			return;
		}
	}

	try {
		const result = await service.importProfiles(parsed, { overwrite });
		const lines: string[] = [];
		lines.push(`Imported ${result.imported.length} profile${result.imported.length === 1 ? "" : "s"}:`);
		for (const name of result.imported) lines.push(`  + ${name}`);
		if (result.overwritten.length > 0) {
			lines.push(`Overwrote ${result.overwritten.length}: ${result.overwritten.join(", ")}`);
		}
		ctx.showStatus(lines.join("\n"));
		// NOTE: do NOT call statusLine?.invalidate() — import does not change the
		// active profile, so the status line's rendering is unchanged. Only
		// handlers that can switch the active profile (activate, rename,
		// namespace) should invalidate. Matches the no-op pattern in handleCreate
		// and handleExport.
	} catch (err) {
		ctx.showError(err instanceof ProfileError ? err.message : String(err));
	}
}

async function handleDelete(ctx: CommandContext, service: ProfileService, args: string[]): Promise<void> {
	const name = args[0];
	const confirmed = args.includes("--confirm");
	if (!name) {
		ctx.showError("Usage: /profile delete <name> --confirm");
		return;
	}
	const status = service.getStatus();
	if (name === status.activeProfileName) {
		ctx.showError("Cannot delete the active profile. Run `/profile activate <other>` to switch first.");
		return;
	}
	if (!confirmed) {
		ctx.showStatus(
			`This will permanently delete profile '${name}' from ~/.config/f5xc/profiles/.\nRun /profile delete ${name} --confirm to proceed.`,
		);
		return;
	}
	try {
		await service.deleteProfile(name);
		ctx.showStatus(`Profile '${name}' deleted.`);
	} catch (err) {
		ctx.showError(err instanceof ProfileError ? err.message : String(err));
	}
}

async function handleNamespace(ctx: CommandContext, service: ProfileService, namespace: string): Promise<void> {
	if (!namespace) {
		ctx.showError(
			"Usage: /profile namespace <name>\nSwitches the active namespace without changing the profile. Default is 'default'.",
		);
		return;
	}
	try {
		service.setNamespace(namespace);
		ctx.showStatus(`Namespace switched to: ${namespace}`);
		ctx.statusLine?.invalidate();
		ctx.updateEditorTopBorder?.();
		ctx.ui?.requestRender();
	} catch (err) {
		ctx.showError(err instanceof ProfileError ? err.message : String(err));
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Environment Variable Management
// ═══════════════════════════════════════════════════════════════════════════

/** Matches KEY=VALUE pairs in freeform text. Keys start with a letter or underscore. */
const ENV_SET_PATTERN = /([A-Za-z_][A-Za-z0-9_]*)=(\S+)/g;

function parseEnvPairs(text: string): Record<string, string> {
	const vars: Record<string, string> = {};
	for (const match of text.matchAll(ENV_SET_PATTERN)) {
		vars[match[1]] = match[2];
	}
	return vars;
}

/** Extract bare KEY names (uppercase env-var-style words) from text, filtering out common verbs. */
const NOISE_WORDS = new Set([
	"remove",
	"unset",
	"delete",
	"clear",
	"drop",
	"env",
	"environment",
	"variable",
	"variables",
	"var",
	"vars",
	"from",
	"my",
	"profile",
	"the",
]);

function parseEnvKeys(text: string): string[] {
	return text.split(/\s+/).filter(w => /^[A-Za-z_][A-Za-z0-9_]*$/.test(w) && !NOISE_WORDS.has(w.toLowerCase()));
}

async function handleEnvSubcommand(ctx: CommandContext, service: ProfileService, args: string[]): Promise<void> {
	const [action, ...rest] = args;
	const arg = rest.join(" ");
	switch (action?.toLowerCase()) {
		case "list":
		case undefined:
		case "":
			return handleEnvList(ctx, service);
		case "set":
		case "add":
			return handleEnvSet(ctx, service, arg);
		case "unset":
		case "remove":
		case "delete":
		case "clear":
			return handleEnvUnset(ctx, service, arg);
		default: {
			// If the action itself contains KEY=VALUE, treat the whole thing as a set
			const fullText = [action, ...rest].join(" ");
			if (ENV_SET_PATTERN.test(fullText)) {
				return handleEnvSet(ctx, service, fullText);
			}
			ctx.showError(`Unknown env action: ${action}. Use /profile env set|unset|list`);
		}
	}
}

async function handleEnvList(ctx: CommandContext, service: ProfileService): Promise<void> {
	const status = service.getStatus();
	const profileName = status.activeProfileName;
	if (!profileName) {
		ctx.showError("No active profile. Use /profile activate <name> first.");
		return;
	}
	const profiles = await service.listProfiles();
	const profile = profiles.find(p => p.name === profileName);
	if (!profile?.env || Object.keys(profile.env).length === 0) {
		ctx.showStatus(`Profile '${profileName}' has no custom environment variables.`);
		return;
	}
	const rows: TableRow[] = [];
	for (const [key, value] of Object.entries(profile.env)) {
		const sensitive = isSensitiveKey(key) || (profile.sensitiveKeys ?? []).includes(key);
		rows.push({ key: sanitize(key), value: sensitive ? service.maskToken(value) : sanitize(value) });
	}
	ctx.showStatus(renderF5XCTable(`${profileName} env`, rows));
}

async function handleEnvSet(ctx: CommandContext, service: ProfileService, args: string): Promise<void> {
	const vars = parseEnvPairs(args);
	const keys = Object.keys(vars);
	if (keys.length === 0) {
		ctx.showError("No KEY=VALUE pairs found. Usage: /profile set KEY=VALUE [KEY2=VALUE2 ...]");
		return;
	}
	const status = service.getStatus();
	const profileName = status.activeProfileName;
	if (!profileName) {
		ctx.showError("No active profile. Use /profile activate <name> first.");
		return;
	}
	try {
		const result = await service.setEnvVars(profileName, vars);
		const lines: string[] = [];
		for (const key of keys) {
			const lock = result.sensitive.includes(key) ? " (auto-sensitive)" : "";
			const displayValue = isSensitiveKey(key) ? "***" : vars[key];
			lines.push(`  ${key}=${displayValue}${lock}`);
		}
		ctx.showStatus(
			`Set ${keys.length} variable${keys.length > 1 ? "s" : ""} on '${profileName}':\n${lines.join("\n")}`,
		);
		ctx.statusLine?.invalidate();
	} catch (err) {
		ctx.showError(err instanceof ProfileError ? err.message : String(err));
	}
}

async function handleEnvUnset(ctx: CommandContext, service: ProfileService, args: string): Promise<void> {
	const keys = parseEnvKeys(args);
	if (keys.length === 0) {
		ctx.showError("No variable names found. Usage: /profile unset KEY [KEY2 ...]");
		return;
	}
	const status = service.getStatus();
	const profileName = status.activeProfileName;
	if (!profileName) {
		ctx.showError("No active profile. Use /profile activate <name> first.");
		return;
	}
	try {
		const result = await service.unsetEnvVars(profileName, keys);
		if (result.removed.length === 0) {
			ctx.showStatus(`No matching variables found on '${profileName}'.`);
			return;
		}
		ctx.showStatus(
			`Removed ${result.removed.length} variable${result.removed.length > 1 ? "s" : ""} from '${profileName}':\n${result.removed.map(k => `  ${k}`).join("\n")}`,
		);
		ctx.statusLine?.invalidate();
	} catch (err) {
		ctx.showError(err instanceof ProfileError ? err.message : String(err));
	}
}
