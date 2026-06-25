import * as fs from "node:fs";
import * as path from "node:path";
import {
	getLocalXCSHActiveContextPath,
	getLocalXCSHContextPath,
	getLocalXCSHContextsDir,
	getProjectDir,
	isSafeContextName,
	t,
} from "@f5xc-salesdemos/pi-utils";
import { expandTilde } from "../tools/path-utils";
import { ContextError, ContextService, CURRENT_SCHEMA_VERSION } from "./xcsh-context";
import { formatStatusIcon } from "./xcsh-context-indicators";
import {
	AUTH_ENV_KEYS,
	deriveTenantFromUrl,
	isSensitiveEnvKey,
	RESERVED_ENV_KEYS,
	XCSH_API_TOKEN,
	XCSH_API_URL,
	XCSH_NAMESPACE,
	XCSH_TENANT,
} from "./xcsh-env";
import {
	formatAuthIndicator,
	formatExpiration,
	formatRelativeTime,
	formatRotation,
	renderContextMessage,
	renderXCSHTable,
	type TableRow,
} from "./xcsh-table";

interface CommandContext {
	showStatus(msg: string, options?: { dim?: boolean }): void;
	showError(msg: string): void;
	editor: { setText(text: string): void };
	statusLine?: { invalidate(): void };
	updateEditorTopBorder?(): void;
	ui?: { requestRender(): void };
}

export async function handleContextCommand(
	command: { name: string; args: string; text: string },
	ctx: CommandContext,
): Promise<void> {
	const [sub, ...rest] = command.args.trim().split(/\s+/);
	const arg = rest.join(" ");
	const service = await ContextService.getOrInit(undefined, getProjectDir());

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
		case "link":
			return handleLink(ctx, service, arg);
		case "unlink":
			return handleUnlink(ctx, service);
		case "env":
			return handleEnvSubcommand(ctx, service, rest);
		case "set":
		case "add":
			return handleEnvSet(ctx, service, arg);
		case "unset":
		case "remove":
		case "clear":
			return handleEnvUnset(ctx, service, arg);
		default: {
			ENV_SET_PATTERN.lastIndex = 0;
			if (ENV_SET_PATTERN.test(command.args)) {
				return handleEnvSet(ctx, service, command.args);
			}
			if (sub === "-") {
				return handleActivatePrevious(ctx, service);
			}
			return handleDirectSwitch(ctx, service, sub!);
		}
	}
}

/** Strip control characters to prevent TUI corruption from malformed context JSON */
function sanitize(value: string): string {
	return value.replace(/[\x00-\x1f\x7f]/g, "");
}

/**
 * Atomic file write: write to a .tmp file then rename.
 * Ensures 0o600 permissions on the resulting file.
 */
function atomicWriteLocal(filePath: string, content: string): void {
	const tmpPath = `${filePath}.tmp`;
	fs.writeFileSync(tmpPath, content, { mode: 0o600 });
	fs.renameSync(tmpPath, filePath);
	fs.chmodSync(filePath, 0o600);
}

/**
 * Split a positional+flag argument list into two groups.
 *
 * Only tokens that exactly match one of `knownFlags` are treated as flags;
 * everything else — including `--`-prefixed tokens that look flag-ish —
 * goes to positionals. This matters because context names allow leading
 * dashes (the name regex is `/^[a-zA-Z0-9_-]{1,64}$/`), so a user with a
 * context named `--prod` needs `splitArgs(["--prod"], new Set(["--include-token"]))`
 * to return `positionals=["--prod"], flags=new Set()` rather than silently
 * eating the name as an unrecognized flag.
 *
 * Callers list the flags they actually understand. Unknown `--`-prefixed
 * tokens that happen not to be valid context names are left in positionals
 * and surface downstream as "not found" errors rather than being silently
 * absorbed.
 */
function splitArgs(args: string[], knownFlags: Set<string>): { positionals: string[]; flags: Set<string> } {
	const positionals: string[] = [];
	const flags = new Set<string>();
	for (const a of args) {
		if (knownFlags.has(a)) flags.add(a);
		else positionals.push(a);
	}
	return { positionals, flags };
}

async function handleList(ctx: CommandContext, service: ContextService): Promise<void> {
	const localContextsDir = getLocalXCSHContextsDir(getProjectDir());
	const hasLocalDir = fs.existsSync(localContextsDir);

	if (hasLocalDir) {
		// Build local context rows by reading .xcsh/contexts/*.json directly
		const localRows: TableRow[] = [];
		try {
			const files = fs.readdirSync(localContextsDir).filter(f => f.endsWith(".json"));
			for (const file of files.sort()) {
				const name = file.slice(0, -5); // strip .json
				try {
					const raw = fs.readFileSync(path.join(localContextsDir, file), "utf-8");
					const parsed = JSON.parse(raw) as Record<string, unknown>;
					const displayUrl =
						typeof parsed.context === "string"
							? `→ ${sanitize(parsed.context)} (pointer)`
							: sanitize(typeof parsed.apiUrl === "string" ? parsed.apiUrl : "");
					localRows.push({ key: `  ${sanitize(name)}`, value: displayUrl });
				} catch {
					localRows.push({ key: `  ${sanitize(name)}`, value: "(unreadable)" });
				}
			}
		} catch {
			// skip unreadable dir
		}

		// Build global context rows
		const globalContexts = await service.listContexts();
		const status = service.getStatus();
		const globalRows: TableRow[] = globalContexts.map(p => {
			const isActive = p.name === status.activeContextName;
			const marker = isActive ? `${formatStatusIcon("connected")} ` : "  ";
			const versionSuffix =
				p.version !== undefined && p.version > CURRENT_SCHEMA_VERSION ? ` (v${p.version} — upgrade required)` : "";
			return { key: `${marker}${sanitize(p.name)}`, value: `${sanitize(p.apiUrl)}${versionSuffix}` };
		});

		// Render combined table with group dividers
		const rows: TableRow[] = [];
		const dividers: Array<{ before: number; label: string }> = [];

		dividers.push({ before: 0, label: "Local contexts (.xcsh/contexts/)" });
		rows.push(...(localRows.length > 0 ? localRows : [{ key: "  (none)", value: "" }]));

		dividers.push({ before: rows.length, label: "Global contexts (~/.config/xcsh/contexts/)" });
		rows.push(...(globalRows.length > 0 ? globalRows : [{ key: "  (none)", value: "" }]));

		ctx.showStatus(renderXCSHTable("contexts", rows, { dividers }), { dim: false });
		return;
	}

	// No local dir — use original flat list behavior
	const contexts = await service.listContexts();
	if (contexts.length === 0) {
		const status = service.getStatus();
		if (status.credentialSource === "environment" && status.activeContextUrl) {
			const label = deriveTenantFromUrl(status.activeContextUrl) ?? "(environment)";
			ctx.showStatus(
				renderContextMessage(
					"contexts",
					`  * ${sanitize(label)}  ${sanitize(status.activeContextUrl)}  (via env vars)`,
				),
				{ dim: false },
			);
			return;
		}
		ctx.showStatus(renderContextMessage("contexts", t("context.list.noneFound")), { dim: false });
		return;
	}
	const status = service.getStatus();
	const rows: TableRow[] = contexts.map(p => {
		const isActive = p.name === status.activeContextName;
		const marker = isActive ? `${formatStatusIcon("connected")} ` : "  ";
		const versionSuffix =
			p.version !== undefined && p.version > CURRENT_SCHEMA_VERSION ? ` (v${p.version} — upgrade required)` : "";
		return { key: `${marker}${sanitize(p.name)}`, value: `${sanitize(p.apiUrl)}${versionSuffix}` };
	});
	ctx.showStatus(renderXCSHTable("contexts", rows), { dim: false });
}

async function handleLink(ctx: CommandContext, service: ContextService, name: string): Promise<void> {
	if (!name) {
		ctx.showError("Usage: /context link <global-context-name>");
		return;
	}
	if (!isSafeContextName(name)) {
		ctx.showError(
			"Invalid context name. Names must be 1-64 characters using only letters, digits, hyphens, or underscores.",
		);
		return;
	}
	const contexts = await service.listContexts();
	const exists = contexts.some(c => c.name === name);
	if (!exists) {
		ctx.showError(`Global context '${name}' not found. Run /context list to see available contexts.`);
		return;
	}
	const localContextsDir = getLocalXCSHContextsDir(getProjectDir());
	if (!fs.existsSync(localContextsDir)) {
		fs.mkdirSync(localContextsDir, { recursive: true, mode: 0o700 });
	}
	const pointerPath = getLocalXCSHContextPath(name, getProjectDir());
	atomicWriteLocal(pointerPath, JSON.stringify({ context: name }, null, 2));
	const activeContextPath = getLocalXCSHActiveContextPath(getProjectDir());
	atomicWriteLocal(activeContextPath, name);
	ctx.showStatus(renderContextMessage(name, `Linked local context '${name}' → global context '${name}'.`), {
		dim: false,
	});
}

async function handleUnlink(ctx: CommandContext, _service: ContextService): Promise<void> {
	const activeContextPath = getLocalXCSHActiveContextPath(getProjectDir());
	if (!fs.existsSync(activeContextPath)) {
		ctx.showError("No local active context found. Run /context link <name> to create one.");
		return;
	}
	const name = fs.readFileSync(activeContextPath, "utf-8").trim();
	if (!isSafeContextName(name)) {
		ctx.showError("Corrupt active_context file — invalid context name. Removing the file.");
		fs.unlinkSync(activeContextPath);
		return;
	}
	const pointerPath = getLocalXCSHContextPath(name, getProjectDir());
	if (fs.existsSync(pointerPath)) {
		fs.unlinkSync(pointerPath);
	}
	fs.unlinkSync(activeContextPath);
	ctx.showStatus(renderContextMessage(name, `Unlinked local context '${name}'.`), { dim: false });
}

async function handleActivate(ctx: CommandContext, service: ContextService, name: string): Promise<void> {
	if (!name) {
		ctx.showError(t("context.activate.usage"));
		return;
	}
	try {
		await service.activate(name);
		ctx.statusLine?.invalidate();
		ctx.updateEditorTopBorder?.();
		ctx.ui?.requestRender();
		// Show the same red table as /context show
		return handleShow(ctx, service);
	} catch (err) {
		ctx.showError(err instanceof ContextError ? err.message : String(err));
	}
}

async function handleDirectSwitch(ctx: CommandContext, service: ContextService, name: string): Promise<void> {
	try {
		await service.activate(name);
		ctx.statusLine?.invalidate();
		ctx.updateEditorTopBorder?.();
		ctx.ui?.requestRender();
		return handleShow(ctx, service);
	} catch (err) {
		if (err instanceof ContextError && err.message.includes("not found")) {
			ctx.showError(t("context.activate.notFound", { name }));
			return;
		}
		ctx.showError(err instanceof ContextError ? err.message : String(err));
	}
}

async function handleActivatePrevious(ctx: CommandContext, service: ContextService): Promise<void> {
	try {
		await service.activatePrevious();
		ctx.statusLine?.invalidate();
		ctx.updateEditorTopBorder?.();
		ctx.ui?.requestRender();
		return handleShow(ctx, service);
	} catch (err) {
		ctx.showError(err instanceof ContextError ? err.message : String(err));
	}
}

async function handleShow(ctx: CommandContext, service: ContextService, name?: string): Promise<void> {
	const targetName = name || service.getStatus().activeContextName;
	if (!targetName) {
		ctx.showError(t("context.show.noActive"));
		return;
	}
	const contexts = await service.listContexts();
	const context = contexts.find(p => p.name === targetName);
	if (!context) {
		ctx.showError(t("context.show.notFound", { name: targetName }));
		return;
	}

	// Derive tenant from URL
	const tenant = deriveTenantFromUrl(context.apiUrl) ?? "";

	// Validate the shown context's token (not necessarily the active one)
	const auth = await service.validateToken({ timeoutMs: 3000, apiUrl: context.apiUrl, apiToken: context.apiToken });

	// Build table rows — auth section first
	const rows: TableRow[] = [
		{ key: XCSH_TENANT, value: sanitize(tenant) },
		{ key: XCSH_API_URL, value: sanitize(context.apiUrl) },
		{ key: XCSH_API_TOKEN, value: service.maskToken(context.apiToken) },
	];

	// Auth-related env vars
	const authKeys: readonly string[] = AUTH_ENV_KEYS;
	for (const key of authKeys) {
		const value = context.env?.[key];
		if (value) {
			rows.push({ key: sanitize(key), value: isSensitiveEnvKey(key) ? service.maskToken(value) : sanitize(value) });
		}
	}

	// Auth status indicator
	rows.push({ key: "Status", value: formatAuthIndicator(auth.status, auth.latencyMs, auth.errorClass) });

	// Track where environment section starts
	const envDividerIndex = rows.length;

	// Environment section: namespace + remaining env vars
	rows.push({ key: XCSH_NAMESPACE, value: sanitize(context.defaultNamespace) });
	if (context.env) {
		for (const [key, value] of Object.entries(context.env)) {
			if (authKeys.includes(key) || RESERVED_ENV_KEYS.has(key)) continue;
			rows.push({ key: sanitize(key), value: isSensitiveEnvKey(key) ? service.maskToken(value) : sanitize(value) });
		}
	}

	// Metadata section (only rendered when at least one field is present)
	const metaRows: TableRow[] = [];
	if (context.metadata?.createdAt) {
		metaRows.push({ key: "Created", value: formatRelativeTime(context.metadata.createdAt) });
	}
	if (context.metadata?.expiresAt) {
		metaRows.push({ key: "Expires", value: formatExpiration(context.metadata.expiresAt) });
	}
	if (context.metadata?.lastRotatedAt) {
		metaRows.push({ key: "Last Rotated", value: formatRelativeTime(context.metadata.lastRotatedAt) });
	}
	if (context.metadata?.rotateAfterDays) {
		metaRows.push({
			key: "Rotation",
			value: formatRotation(context.metadata.rotateAfterDays, context.metadata?.lastRotatedAt),
		});
	}

	if (context.knowledgeSources && context.knowledgeSources.length > 0) {
		for (const src of context.knowledgeSources) {
			const label = src.label ?? src.type ?? "source";
			metaRows.push({ key: `Knowledge (${label})`, value: sanitize(src.url) });
		}
	}
	if (context.includeSkills && context.includeSkills.length > 0) {
		metaRows.push({ key: "Include Skills", value: sanitize(context.includeSkills.join(", ")) });
	}
	if (context.excludeSkills && context.excludeSkills.length > 0) {
		metaRows.push({ key: "Exclude Skills", value: sanitize(context.excludeSkills.join(", ")) });
	}

	const dividers: Array<{ before: number; label: string }> = [{ before: envDividerIndex, label: "Environment" }];
	if (metaRows.length > 0) {
		dividers.push({ before: rows.length, label: "Metadata" });
		rows.push(...metaRows);
	}

	ctx.showStatus(renderXCSHTable(context.name, rows, { dividers }), { dim: false });
}

async function handleValidate(ctx: CommandContext, service: ContextService, name: string): Promise<void> {
	if (!name) {
		ctx.showError(t("context.validate.usage"));
		return;
	}
	try {
		const result = await service.validateContextByName(name);
		const tenant = deriveTenantFromUrl(result.context.apiUrl) ?? "";
		const rows: TableRow[] = [
			{ key: XCSH_TENANT, value: sanitize(tenant) },
			{ key: XCSH_API_URL, value: sanitize(result.context.apiUrl) },
			{ key: XCSH_API_TOKEN, value: service.maskToken(result.context.apiToken) },
			{ key: "Status", value: formatAuthIndicator(result.status, result.latencyMs, result.errorClass) },
		];
		ctx.showStatus(renderXCSHTable(`${result.context.name} (validation only)`, rows), { dim: false });
	} catch (err) {
		ctx.showError(err instanceof ContextError ? err.message : String(err));
	}
}

async function handleStatus(ctx: CommandContext, service: ContextService): Promise<void> {
	const status = service.getStatus();
	if (!status.isConfigured) {
		ctx.showStatus(renderContextMessage("status", t("context.status.notConfigured")), { dim: false });
		return;
	}
	const auth = await service.validateToken({ timeoutMs: 3000 });
	const rows: TableRow[] = [
		{ key: "Tenant", value: status.activeContextTenant ?? "(unknown)" },
		{ key: "Source", value: status.credentialSource },
		{ key: "API URL", value: status.activeContextUrl ?? "(not set)" },
		{ key: "Namespace", value: status.activeContextNamespace ?? "(not set)" },
		{ key: "Status", value: formatAuthIndicator(auth.status, auth.latencyMs, auth.errorClass) },
	];
	ctx.showStatus(renderXCSHTable(status.activeContextName ?? "status", rows), { dim: false });
}

async function handleCreate(ctx: CommandContext, service: ContextService, args: string[]): Promise<void> {
	const [name, url, token, namespace] = args;
	if (!name || !url || !token) {
		ctx.showError(t("context.create.usage"));
		return;
	}
	if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
		ctx.showError(t("context.create.invalidName"));
		return;
	}
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "https:" || !parsed.hostname || parsed.hostname.includes(" ")) {
			ctx.showError(t("context.create.invalidUrl"));
			return;
		}
		const labels = parsed.hostname.replace(/\.$/, "").split(".");
		if (labels.length < 2 || labels.some(l => l.length === 0)) {
			ctx.showError(t("context.create.invalidUrl"));
			return;
		}
	} catch {
		ctx.showError(t("context.create.invalidUrl"));
		return;
	}
	try {
		await service.createContext({
			name,
			apiUrl: url,
			apiToken: token,
			defaultNamespace: namespace ?? "default",
		});
		ctx.showStatus(renderContextMessage(name, `Created. Use /context activate ${name} to switch to it.`), {
			dim: false,
		});
	} catch (err) {
		ctx.showError(err instanceof ContextError ? err.message : String(err));
	}
}

async function handleRename(ctx: CommandContext, service: ContextService, args: string[]): Promise<void> {
	const [oldName, newName] = args;
	if (!oldName || !newName) {
		ctx.showError(t("context.rename.usage"));
		return;
	}
	try {
		await service.renameContext(oldName, newName);
		ctx.showStatus(renderContextMessage(newName, `Renamed from '${oldName}'.`), { dim: false });
		ctx.statusLine?.invalidate();
		ctx.updateEditorTopBorder?.();
		ctx.ui?.requestRender();
	} catch (err) {
		ctx.showError(err instanceof ContextError ? err.message : String(err));
	}
}

const EXPORT_KNOWN_FLAGS = new Set(["--include-token"]);

async function handleExport(ctx: CommandContext, service: ContextService, args: string[]): Promise<void> {
	const { positionals, flags } = splitArgs(args, EXPORT_KNOWN_FLAGS);
	if (positionals.length > 1) {
		ctx.showError(t("context.export.usage"));
		return;
	}
	const includeToken = flags.has("--include-token");
	try {
		const bundle = await service.exportContexts({
			names: positionals.length === 1 ? [positionals[0]] : undefined,
			includeToken,
		});
		ctx.showStatus(JSON.stringify(bundle, null, 2));
	} catch (err) {
		ctx.showError(err instanceof ContextError ? err.message : String(err));
	}
}

async function handleImport(ctx: CommandContext, service: ContextService, rawArgs: string): Promise<void> {
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
		ctx.showError(t("context.import.usage"));
		return;
	}

	let parsed: unknown;
	if (source.startsWith("{")) {
		// Inline JSON
		try {
			parsed = JSON.parse(source);
		} catch (err) {
			ctx.showError(t("context.import.invalidJson", { message: err instanceof Error ? err.message : String(err) }));
			return;
		}
	} else {
		// File path — pass process.env.HOME so tests that mutate HOME are honoured
		const filePath = expandTilde(source, process.env.HOME);
		if (!fs.existsSync(filePath)) {
			ctx.showError(t("context.import.fileNotFound", { path: source }));
			return;
		}
		try {
			const content = fs.readFileSync(filePath, "utf-8");
			parsed = JSON.parse(content);
		} catch (err) {
			ctx.showError(t("context.import.invalidJson", { message: err instanceof Error ? err.message : String(err) }));
			return;
		}
	}

	try {
		const result = await service.importContexts(parsed, { overwrite });
		const bodyLines: string[] = [];
		bodyLines.push(`Imported ${result.imported.length} context${result.imported.length === 1 ? "" : "s"}:`);
		for (const name of result.imported) bodyLines.push(`  + ${name}`);
		if (result.overwritten.length > 0) {
			bodyLines.push(`Overwrote ${result.overwritten.length}: ${result.overwritten.join(", ")}`);
		}
		ctx.showStatus(renderContextMessage("import", bodyLines.join("\n")), { dim: false });
		// Invalidate TUI chrome IF the active context was overwritten. The
		// service's importContexts re-activates the active context when an
		// overwrite touches it, which means #activeContext, bash.environment,
		// and cached auth metadata all mutated. The status-line segment and
		// editor top-border are handler-driven (not listener-driven), so
		// without this the chrome advertises the old tenant until another
		// command triggers a refresh. Match the pattern in handleRename.
		const activeName = service.getStatus().activeContextName;
		if (activeName && result.overwritten.includes(activeName)) {
			ctx.statusLine?.invalidate();
			ctx.updateEditorTopBorder?.();
			ctx.ui?.requestRender();
		}
	} catch (err) {
		ctx.showError(err instanceof ContextError ? err.message : String(err));
	}
}

async function handleDelete(ctx: CommandContext, service: ContextService, args: string[]): Promise<void> {
	const name = args[0];
	const confirmed = args.includes("--confirm");
	if (!name) {
		ctx.showError(t("context.delete.usage"));
		return;
	}
	const status = service.getStatus();
	if (name === status.activeContextName) {
		ctx.showError(t("context.delete.cannotDeleteActive"));
		return;
	}
	if (!confirmed) {
		ctx.showStatus(
			renderContextMessage(
				name,
				`This will permanently delete context '${name}' from ~/.config/xcsh/contexts/.\nRun /context delete ${name} --confirm to proceed.`,
			),
			{ dim: false },
		);
		return;
	}
	try {
		await service.deleteContext(name);
		ctx.showStatus(renderContextMessage(name, "Deleted."), { dim: false });
	} catch (err) {
		ctx.showError(err instanceof ContextError ? err.message : String(err));
	}
}

async function handleNamespace(ctx: CommandContext, service: ContextService, namespace: string): Promise<void> {
	if (!namespace) {
		ctx.showError(t("context.namespace.usage"));
		return;
	}
	try {
		service.setNamespace(namespace);
		ctx.showStatus(renderContextMessage("namespace", `Namespace → ${namespace}`), { dim: false });
		ctx.statusLine?.invalidate();
		ctx.updateEditorTopBorder?.();
		ctx.ui?.requestRender();
	} catch (err) {
		ctx.showError(err instanceof ContextError ? err.message : String(err));
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Environment Variable Management
// ═══════════════════════════════════════════════════════════════════════════

/** Matches KEY=VALUE pairs in freeform text. Keys start with a letter or underscore. */
const ENV_SET_PATTERN = /([A-Za-z_][A-Za-z0-9_]*)=(\S+)/g;

function parseEnvPairs(text: string): Record<string, string> {
	const vars: Record<string, string> = {};
	ENV_SET_PATTERN.lastIndex = 0;
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
	"context",
	"the",
]);

function parseEnvKeys(text: string): string[] {
	return text.split(/\s+/).filter(w => /^[A-Za-z_][A-Za-z0-9_]*$/.test(w) && !NOISE_WORDS.has(w.toLowerCase()));
}

async function handleEnvSubcommand(ctx: CommandContext, service: ContextService, args: string[]): Promise<void> {
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
			ctx.showError(t("context.env.unknownAction", { action: action! }));
		}
	}
}

async function handleEnvList(ctx: CommandContext, service: ContextService): Promise<void> {
	const status = service.getStatus();
	const contextName = status.activeContextName;
	if (!contextName) {
		ctx.showError(t("context.env.noActive"));
		return;
	}
	const contexts = await service.listContexts();
	const context = contexts.find(p => p.name === contextName);
	if (!context?.env || Object.keys(context.env).length === 0) {
		ctx.showStatus(renderContextMessage(`${contextName} env`, "No custom environment variables."), { dim: false });
		return;
	}
	const rows: TableRow[] = [];
	for (const [key, value] of Object.entries(context.env)) {
		const sensitive = isSensitiveEnvKey(key) || (context.sensitiveKeys ?? []).includes(key);
		rows.push({ key: sanitize(key), value: sensitive ? service.maskToken(value) : sanitize(value) });
	}
	ctx.showStatus(renderXCSHTable(`${contextName} env`, rows), { dim: false });
}

async function handleEnvSet(ctx: CommandContext, service: ContextService, args: string): Promise<void> {
	const vars = parseEnvPairs(args);
	const keys = Object.keys(vars);
	if (keys.length === 0) {
		ctx.showError(t("context.env.set.usage"));
		return;
	}
	const status = service.getStatus();
	const contextName = status.activeContextName;
	if (!contextName) {
		ctx.showError(t("context.env.noActive"));
		return;
	}
	try {
		const result = await service.setEnvVars(contextName, vars);
		const bodyLines: string[] = [];
		bodyLines.push(`Set ${keys.length} variable${keys.length > 1 ? "s" : ""} on '${contextName}':`);
		for (const key of keys) {
			const lock = result.sensitive.includes(key) ? " (auto-sensitive)" : "";
			const displayValue = isSensitiveEnvKey(key) ? "***" : vars[key];
			bodyLines.push(`  ${key}=${displayValue}${lock}`);
		}
		ctx.showStatus(renderContextMessage(contextName, bodyLines.join("\n")), { dim: false });
		ctx.statusLine?.invalidate();
	} catch (err) {
		ctx.showError(err instanceof ContextError ? err.message : String(err));
	}
}

async function handleEnvUnset(ctx: CommandContext, service: ContextService, args: string): Promise<void> {
	const keys = parseEnvKeys(args);
	if (keys.length === 0) {
		ctx.showError(t("context.env.unset.usage"));
		return;
	}
	const status = service.getStatus();
	const contextName = status.activeContextName;
	if (!contextName) {
		ctx.showError(t("context.env.noActive"));
		return;
	}
	try {
		const result = await service.unsetEnvVars(contextName, keys);
		if (result.removed.length === 0) {
			ctx.showStatus(renderContextMessage(contextName, "No matching variables found."), { dim: false });
			return;
		}
		ctx.showStatus(
			renderContextMessage(
				contextName,
				`Removed ${result.removed.length} variable${result.removed.length > 1 ? "s" : ""} from '${contextName}':\n${result.removed.map(k => `  ${k}`).join("\n")}`,
			),
			{ dim: false },
		);
		ctx.statusLine?.invalidate();
	} catch (err) {
		ctx.showError(err instanceof ContextError ? err.message : String(err));
	}
}
