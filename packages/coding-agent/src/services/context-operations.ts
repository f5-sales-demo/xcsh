import * as fs from "node:fs";
import { getLocalXCSHActiveContextPath, isPointerContext, isSafeContextName } from "@f5-sales-demo/pi-utils";
import { CliUsageError } from "@f5-sales-demo/pi-utils/cli";
import type { ContextService, ContextTarget, XCSHContext } from "./xcsh-context";
import { isInjectableContextEnvKey, isSensitiveEnvKey } from "./xcsh-env";

export const CONTEXT_ACTIONS = [
	"list",
	"show",
	"validate",
	"create",
	"edit",
	"rename",
	"delete",
	"link",
	"unlink",
	"env",
	"import",
	"export",
] as const;
export type ContextAction = (typeof CONTEXT_ACTIONS)[number];
export interface ContextOperation {
	action: ContextAction;
	target?: ContextTarget;
	newName?: string;
	apiUrl?: string;
	apiToken?: string;
	namespace?: string;
	confirm?: boolean;
	includeToken?: boolean;
	overwrite?: boolean;
	bundle?: unknown;
	env?: Record<string, string>;
	unset?: string[];
}

function assertCredentialUrl(apiUrl: string): void {
	try {
		const url = new URL(apiUrl);
		if (url.protocol !== "https:" || url.username || url.password) throw new Error();
	} catch {
		throw new CliUsageError("Tenant URL must be HTTPS without embedded credentials.");
	}
}

export function maskedContext(context: XCSHContext): Record<string, unknown> {
	return {
		name: context.name,
		apiUrl: context.apiUrl,
		defaultNamespace: context.defaultNamespace,
		version: context.version,
		metadata: context.metadata,
		knowledgeSources: context.knowledgeSources,
		includeSkills: context.includeSkills,
		excludeSkills: context.excludeSkills,
		sensitiveKeys: context.sensitiveKeys,
		apiToken: "••••",
		env: context.env
			? Object.fromEntries(
					Object.entries(context.env).map(([key, value]) => [
						key,
						isSensitiveEnvKey(key) || context.sensitiveKeys?.includes(key) ? "••••" : value,
					]),
				)
			: undefined,
	};
}

/** No prompts, model inference, rendering, or implicit target selection. */
export async function executeContextOperation(
	service: ContextService,
	op: ContextOperation,
	cwd: string,
): Promise<unknown> {
	if (op.action === "list")
		return (await service.listChoices(cwd)).map(choice => ({
			target: choice.target,
			...(choice.context ? { context: maskedContext(choice.context) } : { error: choice.error }),
		}));
	if (op.action === "import") return service.importContexts(op.bundle, { overwrite: op.overwrite ?? false });
	if (op.action === "export") {
		if (op.target?.source === "local") throw new CliUsageError("Bundle export uses global contexts.");
		return service.exportContexts({
			names: op.target ? [op.target.name] : undefined,
			includeToken: op.includeToken ?? false,
		});
	}
	if (!op.target || !isSafeContextName(op.target.name))
		throw new CliUsageError(`context ${op.action} requires a valid explicit target`);
	const target = op.target;
	for (const key of Object.keys(op.env ?? {}))
		if (!isInjectableContextEnvKey(key))
			throw new CliUsageError("Only non-reserved XCSH_ environment keys are allowed.");
	if (op.action === "show") return { target, context: maskedContext(service.resolveTarget(target, cwd)) };
	if (op.action === "validate") {
		const context = service.resolveTarget(target, cwd);
		return {
			target,
			...(await service.validateToken({ apiUrl: context.apiUrl, apiToken: context.apiToken, timeoutMs: 5000 })),
		};
	}
	const file = service.targetPath(target, cwd);
	const original = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
	if (op.action === "create") {
		if (!op.apiUrl || !op.apiToken) throw new CliUsageError("context create requires URL and --token-stdin");
		if (original !== null) throw new Error("Context already exists.");
		assertCredentialUrl(op.apiUrl);
		const check = await service.validateToken({ apiUrl: op.apiUrl, apiToken: op.apiToken, timeoutMs: 5000 });
		if (check.status !== "connected") return { target, ...check };
		await service.saveTarget(
			target,
			{
				name: target.name,
				apiUrl: op.apiUrl,
				apiToken: op.apiToken,
				defaultNamespace: op.namespace ?? "default",
				version: 1,
				metadata: { createdAt: new Date().toISOString() },
			},
			null,
			cwd,
		);
		return { target, saved: true };
	}
	if (op.action === "link" || op.action === "unlink") {
		if (target.source !== "local")
			throw new CliUsageError("Project links require --source local and an explicit pointer name.");
		if (op.action === "link") {
			if (!op.newName) throw new CliUsageError("context link requires a global context name");
			service.resolveTarget({ name: op.newName, source: "global" }, cwd);
			if (original !== null) throw new Error("Local target already exists.");
			await service.writePointer(target, { context: op.newName }, original, cwd);
			service.writeProjectActive(target.name, cwd);
		} else {
			if (!original || !isPointerContext(JSON.parse(original))) throw new Error("Target is not a project pointer.");
			fs.unlinkSync(file);
			service.clearProjectActive(target.name, cwd);
		}
		return { target, [op.action === "link" ? "linked" : "unlinked"]: true };
	}
	if (op.action === "delete") {
		if (!op.confirm) throw new CliUsageError("context delete requires --confirm");
		if (!original) throw new Error("Context does not exist.");
		if (target.source === "global") await service.deleteContext(target.name);
		else {
			fs.unlinkSync(file);
			service.clearProjectActive(target.name, cwd);
		}
		return { target, deleted: true };
	}
	if (op.action === "rename") {
		if (!op.newName || !isSafeContextName(op.newName))
			throw new CliUsageError("context rename requires a valid new name");
		if (target.source === "global") await service.renameContext(target.name, op.newName);
		else {
			if (!original) throw new Error("Context does not exist.");
			const destination = service.targetPath({ ...target, name: op.newName }, cwd);
			if (fs.existsSync(destination)) throw new Error("New name already exists.");
			const data = JSON.parse(original);
			if (isPointerContext(data)) await service.writePointer({ ...target, name: op.newName }, data, null, cwd);
			else await service.saveTarget({ ...target, name: op.newName }, { ...data, name: op.newName }, null, cwd);
			fs.unlinkSync(file);
			const active = getLocalXCSHActiveContextPath(cwd);
			if (fs.existsSync(active) && fs.readFileSync(active, "utf8").trim() === target.name)
				service.writeProjectActive(op.newName, cwd);
		}
		return { target: { ...target, name: op.newName }, renamed: true };
	}
	const context = service.resolveTarget(target, cwd);
	if (op.action === "env" && !op.env && !op.unset) return { target, env: maskedContext(context).env ?? {} };
	if (op.action === "edit" && !op.apiUrl && op.apiToken === undefined && op.namespace === undefined)
		throw new CliUsageError("context edit requires --url, --token-stdin, or --namespace");
	if (original && isPointerContext(JSON.parse(original))) {
		if (op.apiUrl || op.apiToken !== undefined)
			throw new CliUsageError("Edit the linked global context explicitly with --source global.");
		const pointer = JSON.parse(original);
		const overrides = {
			...pointer.overrides,
			...(op.namespace !== undefined ? { defaultNamespace: op.namespace } : {}),
		};
		if (op.env || op.unset) {
			overrides.env = { ...overrides.env, ...op.env };
			for (const key of op.unset ?? []) delete overrides.env[key];
			overrides.unsetEnv = [...new Set([...(overrides.unsetEnv ?? []), ...(op.unset ?? [])])].filter(
				key => !(key in (op.env ?? {})),
			);
			overrides.sensitiveKeys = [
				...new Set([...(context.sensitiveKeys ?? []), ...Object.keys(op.env ?? {}).filter(isSensitiveEnvKey)]),
			].filter(key => !overrides.unsetEnv.includes(key));
		}
		await service.writePointer(target, { ...pointer, overrides }, original, cwd);
	} else {
		const next = {
			...context,
			apiUrl: op.apiUrl ?? context.apiUrl,
			apiToken: op.apiToken ?? context.apiToken,
			defaultNamespace: op.namespace ?? context.defaultNamespace,
		};
		if (op.apiUrl || op.apiToken !== undefined) {
			assertCredentialUrl(next.apiUrl);
			const check = await service.validateToken({ apiUrl: next.apiUrl, apiToken: next.apiToken, timeoutMs: 5000 });
			if (check.status !== "connected") return { target, ...check };
		}
		if (op.env || op.unset) {
			for (const key of Object.keys(op.env ?? {}))
				if (!isInjectableContextEnvKey(key))
					throw new CliUsageError("Only non-reserved XCSH_ environment keys are allowed.");
			next.env = { ...context.env, ...op.env };
			for (const key of op.unset ?? []) delete next.env[key];
			next.sensitiveKeys = [
				...new Set([...(context.sensitiveKeys ?? []), ...Object.keys(op.env ?? {}).filter(isSensitiveEnvKey)]),
			].filter(key => key in next.env!);
		}
		await service.saveTarget(target, next, original, cwd);
	}
	return { target, saved: true };
}
