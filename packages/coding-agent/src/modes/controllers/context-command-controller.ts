import { createHash } from "node:crypto";
import * as fs from "node:fs";
import {
	getLocalXCSHActiveContextPath,
	getLocalXCSHContextPath,
	getProjectDir,
	isSafeContextName,
} from "@f5-sales-demo/pi-utils";
import type { XCSHContext } from "../../services/xcsh-context";
import { ContextService } from "../../services/xcsh-context";
import { isSensitiveEnvKey } from "../../services/xcsh-env";
import { renderContextMessage } from "../../services/xcsh-table";
import { expandTilde } from "../../tools/path-utils";
import { ContextAddWizard } from "../components/context-add-wizard";
import type { ActionReview } from "../components/reviewed-action";
import { runReviewedAction } from "../components/reviewed-action-dialog";
import { ReportDetailsComponent } from "../components/selector-frame";
import type { InteractiveModeContext } from "../types";

interface ContextReviewTarget {
	command: { name: string; args: string; text: string };
}

function digest(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function contextSummary(context: XCSHContext | undefined): string {
	if (!context) return "Absent";
	return `${context.apiUrl} · namespace ${context.defaultNamespace || "(none)"} · credential masked`;
}

function sameContextConfiguration(left: XCSHContext, right: XCSHContext): boolean {
	return (
		digest({
			apiUrl: left.apiUrl,
			apiToken: left.apiToken,
			defaultNamespace: left.defaultNamespace,
			env: left.env,
			sensitiveKeys: left.sensitiveKeys,
		}) ===
		digest({
			apiUrl: right.apiUrl,
			apiToken: right.apiToken,
			defaultNamespace: right.defaultNamespace,
			env: right.env,
			sensitiveKeys: right.sensitiveKeys,
		})
	);
}

function parseEnvAssignments(text: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const match of text.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(\S+)/g)) result[match[1]] = match[2];
	return result;
}

function parseEnvNames(text: string): string[] {
	return text.split(/\s+/).filter(value => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value));
}

function displayEnvValue(context: XCSHContext | undefined, key: string, value: string | undefined): string {
	if (value === undefined) return "Absent";
	if (isSensitiveEnvKey(key) || context?.sensitiveKeys?.includes(key)) return "•••• (masked)";
	return value;
}

function importSource(rawArgs: string): { parsed: unknown; overwrite: boolean; source: string } | undefined {
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
	if (!source) return undefined;
	if (source.startsWith("{")) return { parsed: JSON.parse(source), overwrite, source: "inline JSON" };
	const filePath = expandTilde(source, process.env.HOME);
	return { parsed: JSON.parse(fs.readFileSync(filePath, "utf8")), overwrite, source: filePath };
}

export class ContextCommandController {
	#ctx: InteractiveModeContext;

	constructor(ctx: InteractiveModeContext) {
		this.#ctx = ctx;
	}

	async handle(command: { name: string; args: string; text: string }): Promise<void> {
		const sub = command.args.trim().split(/\s+/)[0];
		if (sub === "wizard") {
			return this.#handleWizard();
		}
		const { handleContextCommand } = await import("../../services/xcsh-context-command");
		let prepared: { review: ActionReview; target: ContextReviewTarget } | undefined;
		try {
			prepared = await this.#prepareMutation(command);
		} catch (error) {
			this.#ctx.showError(error instanceof Error ? error.message : String(error));
			return;
		}
		if (!prepared) {
			if (this.#isReportCommand(command.args)) await this.#runReportCommand(command, handleContextCommand);
			else await handleContextCommand(command, this.#ctx);
			return;
		}
		const outcome = await runReviewedAction(this.#ctx, "context change", {
			review: prepared.review,
			resolve: () => this.#prepareMutation(command),
			execute: async target => handleContextCommand(target.command, this.#ctx),
		});
		if (outcome === "busy") this.#ctx.showStatus("Another reviewed action is already open.");
		else if (outcome === "unresolved")
			this.#ctx.showError("The context change remains unresolved. Reopen /context to review and retry it.");
	}

	#isReportCommand(args: string): boolean {
		const [sub = "", nested = ""] = args.trim().toLowerCase().split(/\s+/);
		if (["", "list", "show", "status", "validate", "export"].includes(sub)) return true;
		if (sub === "env" && ["", "list"].includes(nested)) return true;
		const knownMutation = [
			"create",
			"delete",
			"rename",
			"import",
			"namespace",
			"link",
			"unlink",
			"set",
			"add",
			"unset",
			"remove",
			"clear",
			"activate",
			"-",
		];
		return !knownMutation.includes(sub) && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(args.trim());
	}

	async #runReportCommand(
		command: { name: string; args: string; text: string },
		handleContextCommand: (
			command: { name: string; args: string; text: string },
			ctx: {
				showStatus(message: string, options?: { dim?: boolean }): void;
				showError(message: string): void;
				editor: { setText(text: string): void };
				statusLine?: { invalidate(): void };
				updateEditorTopBorder?(): void;
				ui?: { requestRender(): void };
			},
		) => Promise<void>,
	): Promise<void> {
		let report: string | undefined;
		await handleContextCommand(command, {
			showStatus: message => {
				report = message;
			},
			showError: message => this.#ctx.showError(message),
			editor: this.#ctx.editor,
			statusLine: this.#ctx.statusLine,
			updateEditorTopBorder: this.#ctx.updateEditorTopBorder?.bind(this.#ctx),
			ui: this.#ctx.ui,
		});
		if (!report) return;
		const action = command.args.trim() || "list";
		await this.#ctx.showHookCustom<void>(
			(ui, _theme, _keys, done) =>
				new ReportDetailsComponent(
					"F5 XC contexts",
					`/context ${action} · saved configuration and current runtime state`,
					report!,
					() => done(),
					() => ui.terminal.rows,
				),
		);
	}

	async #prepareMutation(command: {
		name: string;
		args: string;
		text: string;
	}): Promise<{ review: ActionReview; target: ContextReviewTarget } | undefined> {
		const raw = command.args.trim();
		const [subRaw = "", ...rest] = raw.split(/\s+/);
		const sub = subRaw.toLowerCase();
		const service = await ContextService.getOrInit(undefined, getProjectDir());
		const contexts = await service.listContexts();
		const byName = new Map(contexts.map(context => [context.name, context]));
		const status = service.getStatus();
		const revision = (proposal: unknown) => digest({ contexts, status, proposal });
		const target = { command };
		const activationName =
			sub === "activate"
				? rest.join(" ")
				: sub === "-"
					? service.previousContextName
					: rest.length === 0 && byName.has(subRaw)
						? subRaw
						: undefined;
		if (activationName) {
			const next = byName.get(activationName);
			if (!next) return undefined;
			return {
				target,
				review: {
					identity: `context-activation:${activationName}`,
					scope: "Current process context selection",
					revision: revision({ activationName, previous: service.previousContextName }),
					changes: [
						{
							field: "Active context",
							before: status.activeContextName ?? "None",
							after: activationName,
						},
						{
							field: "Effective namespace",
							before: status.activeContextNamespace || "(none)",
							after: next.defaultNamespace || "(none)",
						},
					],
					consequence:
						"Replaces the current process endpoint, masked credential, namespace, and context-derived environment. Saved context files and the startup selection are unchanged.",
				},
			};
		}

		if (sub === "create") {
			const [name, url, token, namespace = "default"] = rest;
			if (!name || !url || !token) return undefined;
			if (byName.has(name)) throw new Error(`Context '${name}' already exists.`);
			const proposal = { name, url, namespace, credential: "masked" };
			return {
				target,
				review: {
					identity: `context:${name}`,
					scope: "Global F5 XC context configuration",
					revision: revision(proposal),
					changes: [
						{ field: "Context", before: "Absent", after: `${url} · namespace ${namespace}` },
						{ field: "API credential", before: "Absent", after: "Saved (masked)" },
					],
					consequence:
						"Creates a credential-bearing context file with private permissions. It does not activate or validate the context.",
				},
			};
		}

		if (sub === "rename") {
			const [oldName, newName] = rest;
			if (!oldName || !newName) return undefined;
			if (!byName.has(oldName)) throw new Error(`Context '${oldName}' not found.`);
			if (oldName === newName) return undefined;
			if (byName.has(newName)) throw new Error(`Context '${newName}' already exists.`);
			return {
				target,
				review: {
					identity: `context:${oldName}`,
					scope: "Global F5 XC context configuration",
					revision: revision({ oldName, newName }),
					changes: [{ field: "Context name", before: oldName, after: newName }],
					consequence: `${status.activeContextName === oldName ? "Updates the active-context identity and current runtime state. " : ""}The endpoint, namespace, and masked credential are retained.`,
				},
			};
		}

		if (sub === "delete") {
			const name = rest[0];
			if (!name || !rest.includes("--confirm")) return undefined;
			const current = byName.get(name);
			if (!current) throw new Error(`Context '${name}' not found.`);
			if (status.activeContextName === name) throw new Error("Cannot delete the active context. Switch first.");
			return {
				target,
				review: {
					identity: `context:${name}`,
					scope: "Global F5 XC context configuration",
					revision: revision({ name, current }),
					changes: [{ field: "Context", before: contextSummary(current), after: "Permanently removed" }],
					consequence:
						"Permanently deletes this saved endpoint, namespace, credential, environment, and metadata. Project-local pointers and unrelated contexts are unchanged.",
				},
			};
		}

		if (sub === "namespace") {
			const namespace = rest.join(" ");
			if (!namespace || !status.activeContextName) return undefined;
			const current = byName.get(status.activeContextName);
			if (!current || status.activeContextNamespace === namespace) return undefined;
			return {
				target,
				review: {
					identity: `context:${current.name}`,
					scope: "Active F5 XC context · current process only",
					revision: revision({ namespace }),
					changes: [
						{
							field: "Effective namespace",
							before: status.activeContextNamespace || "(none)",
							after: namespace,
						},
						{
							field: "Saved default namespace",
							before: current.defaultNamespace || "(none)",
							after: `${current.defaultNamespace || "(none)"} (unchanged)`,
						},
					],
					consequence:
						"Changes the effective namespace for subsequent resource operations in this process. No context file is written; reactivation or restart restores the saved default.",
				},
			};
		}

		const envAction = sub === "env" ? rest[0]?.toLowerCase() : sub;
		const envTail = sub === "env" ? rest.slice(1).join(" ") : raw;
		if (["set", "add"].includes(envAction) || Object.keys(parseEnvAssignments(raw)).length > 0) {
			const vars = parseEnvAssignments(envTail);
			if (!Object.keys(vars).length || !status.activeContextName) return undefined;
			const current = byName.get(status.activeContextName);
			if (!current) return undefined;
			return {
				target,
				review: {
					identity: `context:${current.name}`,
					scope: "Active F5 XC context · saved environment",
					revision: revision({ vars }),
					changes: Object.entries(vars).map(([key, value]) => ({
						field: `Environment ${key}`,
						before: displayEnvValue(current, key, current.env?.[key]),
						after: displayEnvValue(current, key, value),
					})),
					consequence:
						"Persists these environment values for future commands; secret-looking values remain masked in this review.",
				},
			};
		}
		if (["unset", "remove", "clear", "delete"].includes(envAction) && sub !== "delete") {
			const keys = parseEnvNames(envTail);
			if (!keys.length || !status.activeContextName) return undefined;
			const current = byName.get(status.activeContextName);
			if (!current) return undefined;
			const present = keys.filter(key => current.env?.[key] !== undefined);
			if (!present.length) return undefined;
			return {
				target,
				review: {
					identity: `context:${current.name}`,
					scope: "Active F5 XC context · saved environment",
					revision: revision({ keys: present }),
					changes: present.map(key => ({
						field: `Environment ${key}`,
						before: displayEnvValue(current, key, current.env?.[key]),
						after: "Removed",
					})),
					consequence: "Removes only the listed saved environment values from the active context.",
				},
			};
		}

		if (sub === "import") {
			const imported = importSource(raw.replace(/^import\s*/i, ""));
			if (!imported) return undefined;
			const value = imported.parsed as { contexts?: unknown };
			const records = Array.isArray(value?.contexts) ? (value.contexts as Array<Record<string, unknown>>) : [];
			const names = records.map(record => String(record.name ?? "(unnamed)"));
			return {
				target,
				review: {
					identity: `context-import:${names.join(",") || "bundle"}`,
					scope: "Global F5 XC context configuration",
					revision: revision({ imported: imported.parsed, overwrite: imported.overwrite }),
					changes: records.map(record => {
						const name = String(record.name ?? "(unnamed)");
						return {
							field: `Context ${name}`,
							before: contextSummary(byName.get(name)),
							after: `${String(record.apiUrl ?? "(invalid endpoint)")} · namespace ${String(record.defaultNamespace ?? "default")} · credential masked`,
						};
					}),
					consequence: `Imports ${records.length} credential-bearing context file(s) from ${imported.source}${imported.overwrite ? "; existing named contexts will be replaced" : "; conflicts will fail without replacement"}.`,
				},
			};
		}

		if (sub === "link") {
			const name = rest.join(" ");
			if (!name || !isSafeContextName(name)) return undefined;
			const pointer = getLocalXCSHContextPath(name, getProjectDir());
			const active = getLocalXCSHActiveContextPath(getProjectDir());
			const proposal = {
				name,
				pointer: fs.existsSync(pointer) ? fs.readFileSync(pointer, "utf8") : null,
				active: fs.existsSync(active) ? fs.readFileSync(active, "utf8") : null,
			};
			return {
				target,
				review: {
					identity: `context-link:${name}`,
					scope: `Project-local context pointers · ${getProjectDir()}`,
					revision: revision(proposal),
					changes: [
						{
							field: "Local context pointer",
							before: proposal.pointer ? "Existing" : "Absent",
							after: name,
						},
						{
							field: "Local active context",
							before: proposal.active?.trim() || "Absent",
							after: name,
						},
					],
					consequence: "Writes project-local pointer files; the global credential-bearing context is not copied.",
				},
			};
		}

		if (sub === "unlink") {
			const activePath = getLocalXCSHActiveContextPath(getProjectDir());
			if (!fs.existsSync(activePath)) return undefined;
			const name = fs.readFileSync(activePath, "utf8").trim();
			const safeName = isSafeContextName(name);
			const pointerPath = safeName ? getLocalXCSHContextPath(name, getProjectDir()) : undefined;
			const proposal = {
				name,
				active: fs.readFileSync(activePath, "utf8"),
				pointer: pointerPath && fs.existsSync(pointerPath) ? fs.readFileSync(pointerPath, "utf8") : null,
			};
			return {
				target,
				review: {
					identity: `context-link:${name}`,
					scope: `Project-local context pointers · ${getProjectDir()}`,
					revision: revision(proposal),
					changes: [
						...(safeName ? [{ field: "Local context pointer", before: name, after: "Removed" }] : []),
						{ field: "Local active context", before: name, after: "Removed" },
					],
					consequence: safeName
						? "Removes only project-local pointer files; the global context and credential remain saved."
						: "Repairs a corrupt project-local active-context file by removing only that file. No path is derived from the invalid contents, and global contexts remain saved.",
				},
			};
		}

		return undefined;
	}

	async #handleWizard(): Promise<void> {
		const done = () => {
			this.#ctx.editorContainer.clear();
			this.#ctx.editorContainer.addChild(this.#ctx.editor);
			this.#ctx.ui.setFocus(this.#ctx.editor);
		};

		const wizard = new ContextAddWizard(
			async (context, shouldActivate) => {
				done();
				try {
					const service = await ContextService.getOrInit();
					const prepare = async () => {
						const contexts = await service.listContexts();
						const existing = contexts.find(candidate => candidate.name === context.name);
						if (existing && !sameContextConfiguration(existing, context))
							throw new Error(`Context '${context.name}' now exists with different values.`);
						const needsCreate = !existing;
						const currentActive = service.getStatus().activeContextName;
						return {
							target: { needsCreate },
							review: {
								identity: `context:${context.name}`,
								scope: "Global F5 XC context configuration",
								revision: digest({ contexts, context, shouldActivate, currentActive, needsCreate }),
								changes: [
									...(needsCreate
										? [{ field: "Context", before: "Absent", after: contextSummary(context) }]
										: []),
									{
										field: "API credential",
										before: needsCreate ? "Absent" : "Saved",
										after: "Saved (masked)",
									},
									...(shouldActivate && currentActive !== context.name
										? [
												{
													field: "Active context",
													before: currentActive ?? "None",
													after: context.name,
												},
											]
										: []),
								],
								consequence: `${needsCreate ? "Creates a private credential-bearing context file. " : "The context file is already saved. "}${shouldActivate ? "Activates it for this process after saving; validation was performed separately." : "It remains inactive; validation was performed separately."}`,
							},
						};
					};
					const prepared = await prepare();
					const outcome = await runReviewedAction(this.#ctx, "context creation", {
						review: prepared.review,
						resolve: prepare,
						execute: async target => {
							if (target.needsCreate) await service.createContext(context);
							if (shouldActivate) await service.activate(context.name);
						},
					});
					if (outcome === "succeeded") {
						this.#ctx.showStatus(
							renderContextMessage(context.name, shouldActivate ? "Created and activated." : "Created."),
							{ dim: false },
						);
						this.#ctx.statusLine?.invalidate();
						this.#ctx.updateEditorTopBorder?.();
						this.#ctx.ui?.requestRender();
					} else if (outcome === "busy") this.#ctx.showStatus("Another reviewed action is already open.");
					else if (outcome === "unresolved")
						this.#ctx.showError("Context creation remains unresolved. Reopen the wizard to retry.");
				} catch (err) {
					this.#ctx.showError(`Failed to create context: ${err instanceof Error ? err.message : String(err)}`);
				}
			},
			() => {
				done();
			},
			() => {
				this.#ctx.ui.requestRender();
			},
		);

		this.#ctx.editorContainer.clear();
		this.#ctx.editorContainer.addChild(wizard);
		this.#ctx.ui.setFocus(wizard);
		this.#ctx.ui.requestRender();
	}
}
