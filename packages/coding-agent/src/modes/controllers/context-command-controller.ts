import { createHash } from "node:crypto";
import * as fs from "node:fs";
import {
	getLocalXCSHActiveContextPath,
	getLocalXCSHContextPath,
	getProjectDir,
	isSafeContextName,
} from "@f5-sales-demo/pi-utils";
import { type ContextOperation, executeContextOperation } from "../../services/context-operations";
import type { ContextTarget, XCSHContext } from "../../services/xcsh-context";
import { ContextService } from "../../services/xcsh-context";
import { isSensitiveEnvKey } from "../../services/xcsh-env";
import { expandTilde } from "../../tools/path-utils";
import { ContextAddWizard } from "../components/context-add-wizard";
import { ContextInput, ContextMenu, ContextPicker } from "../components/context-picker";
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
	#pickerActive = false;
	#draftActivated = false;

	constructor(ctx: InteractiveModeContext) {
		this.#ctx = ctx;
	}

	async handleGuidedSetup(): Promise<void> {
		const service = await ContextService.getOrInit(undefined, getProjectDir());
		const savedNames = (await service.listContexts()).map(context => context.name).sort();
		if (!service.getStatus().activeContextName && savedNames.length > 0) {
			this.#ctx.showStatus(
				[
					"Platform setup requires an active context for this xcsh session.",
					"Saved contexts:",
					...savedNames.map(name => `  /context activate ${name}`),
					"Run one command above. To add another context, run /context wizard.",
				].join("\n"),
			);
			return;
		}
		void this.#handleWizard();
	}

	async handle(command: { name: string; args: string; text: string }): Promise<void> {
		const tokens = command.args.trim().split(/\s+/);
		const sub = tokens[0]?.toLowerCase();
		const service = await ContextService.getOrInit(undefined, getProjectDir());
		if (!sub || (sub === "activate" && !tokens[1])) return this.#picker();
		if (sub === "edit") {
			void this.#edit(tokens[1] ? { name: tokens[1], source: "global" } : undefined);
			return;
		}
		if (sub === "create" && tokens.length < 4) {
			void this.#handleWizard(tokens.slice(1));
			return;
		}
		if (
			sub === "activate" ||
			sub === "-" ||
			((await service.listContexts()).some(context => context.name === tokens[0]) && tokens.length === 1)
		) {
			const target =
				sub === "-" ? undefined : { name: sub === "activate" ? tokens[1] : tokens[0], source: "global" as const };
			return this.#activate(target, sub === "-");
		}
		if (
			[
				"rename",
				"delete",
				"link",
				"namespace",
				"validate",
				"import",
				"export",
				"env",
				"set",
				"unset",
				"add",
				"remove",
				"clear",
			].includes(sub) &&
			(tokens.length === 1 ||
				(sub === "rename" && tokens.length < 3) ||
				(sub === "delete" && !tokens.includes("--confirm")))
		)
			return this.#guided(sub, tokens.slice(1));
		if (sub === "namespace" && tokens[1]) {
			service.setNamespace(tokens.slice(1).join(" "));
			this.#ctx.showStatus(`Namespace ${service.getStatus().activeContextNamespace} · future turns`);
			return;
		}
		if (sub === "env" && ["set", "unset", "add", "remove"].includes(tokens[1]) && tokens.length < 3)
			return this.#guided(tokens[1]);
		const activeTarget = service.activeTarget;
		if (activeTarget?.source === "local") {
			const nested = sub === "env" ? tokens[1] : sub;
			if (["set", "add", "unset", "remove", "clear"].includes(nested)) {
				const values = tokens.slice(sub === "env" ? 2 : 1);
				if (!values.length) return this.#guided(nested, [], activeTarget);
				if (["set", "add"].includes(nested))
					return this.#reviewOperation({
						action: "env",
						target: activeTarget,
						env: parseEnvAssignments(values.join(" ")),
					});
				return this.#reviewOperation({ action: "env", target: activeTarget, unset: values });
			}
			if (sub === "env" && (!tokens[1] || tokens[1] === "list")) {
				const result = await executeContextOperation(
					service,
					{ action: "env", target: activeTarget },
					getProjectDir(),
				);
				this.#ctx.showStatus(JSON.stringify(result, null, 2));
				return;
			}
			if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(command.args))
				return this.#reviewOperation({
					action: "env",
					target: activeTarget,
					env: parseEnvAssignments(command.args),
				});
		}
		if (sub === "wizard") {
			void this.#handleWizard();
			return;
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
		if (outcome === "succeeded") this.#invalidateIntegrations();
		else if (outcome === "busy") this.#ctx.showStatus("Another reviewed action is already open.");
		else if (outcome === "unresolved")
			this.#ctx.showError("The context change remains unresolved. Reopen /context to review and retry it.");
	}

	async #input(title: string, detail = "", value = "", masked = false): Promise<string | undefined> {
		return this.#ctx.showHookCustom<string | undefined>(
			(ui, _theme, _keys, done) => new ContextInput(title, detail, value, masked, done, () => ui.terminal.rows),
		);
	}
	async #menu(title: string, labels: string[]): Promise<number | undefined> {
		return this.#ctx.showHookCustom<number | undefined>(
			(ui, _theme, _keys, done) => new ContextMenu(title, labels, done, () => ui.terminal.rows),
		);
	}
	async #chooseTarget(): Promise<ContextTarget | undefined> {
		const service = await ContextService.getOrInit();
		const choices = await service.listChoices();
		const index = await this.#menu(
			"Choose context",
			choices.map(choice => `${choice.target.name} · ${choice.target.source}`),
		);
		return index === undefined ? undefined : choices[index]?.target;
	}
	async #picker(): Promise<void> {
		if (this.#pickerActive) return;
		this.#pickerActive = true;
		try {
			const service = await ContextService.getOrInit();
			let state: import("../components/context-picker").ContextPickerState | undefined;
			for (;;) {
				const choices = await service.listChoices();
				const result = await this.#ctx.showHookCustom<
					import("../components/context-picker").ContextPickerResult | undefined
				>((ui, _theme, _keys, done) => {
					const picker = new ContextPicker(
						choices,
						service.activeTarget,
						result => {
							state = picker.state;
							done(result);
						},
						() => ui.terminal.rows,
						state,
					);
					return picker;
				});
				if (!result) return;
				if (result.action === "activate") {
					await this.#activate(result.target);
					return;
				}
				if (result.action === "create") {
					await this.#handleWizard();
					if (this.#draftActivated) return;
					continue;
				}
				if (result.action === "manage") {
					await this.#manage();
					continue;
				}
				if (result.action === "actions") {
					await this.#actions(result.target);
					if (this.#draftActivated) return;
				}
			}
		} finally {
			this.#pickerActive = false;
		}
	}
	async #activate(target?: ContextTarget, previous = false, reportOnly = true): Promise<void> {
		try {
			const service = await ContextService.getOrInit();
			const context = previous ? await service.activatePrevious() : await service.activate(target!);
			const generation = service.getStatus().activationGeneration;
			const currentWork = this.#ctx.session?.currentWorkContextName;
			if (currentWork && currentWork !== context.name)
				this.#ctx.showStatus(`Current work: ${currentWork} · Next turn: ${context.name}`);
			this.#ctx.showStatus(
				`Selected ${context.name} · namespace ${service.getStatus().activeContextNamespace} · Checking`,
				{ dim: false },
			);
			this.#ctx.statusLine?.invalidate();
			this.#ctx.updateEditorTopBorder?.();
			this.#invalidateIntegrations();
			void service.validateToken({ timeoutMs: 5000 }).then(result => {
				if (service.getStatus().activationGeneration !== generation) return;
				this.#ctx.showStatus(
					result.status === "connected"
						? `Connected · ${context.name}`
						: `Selected ${context.name} · ${result.failureReason ?? "connection unavailable"}. Open context actions to validate or edit credentials.`,
					{ dim: false },
				);
				this.#ctx.statusLine?.invalidate();
				this.#ctx.ui.requestRender();
			});
		} catch (error) {
			if (!reportOnly) throw error;
			this.#ctx.showError(error instanceof Error ? error.message : "Selection failed");
		}
	}
	async #actions(target: ContextTarget): Promise<void> {
		const index = await this.#menu(`${target.name} · ${target.source}`, [
			"Details",
			"Validate",
			"Edit",
			"Session namespace",
			"Rename",
			"Delete",
			"Environment",
			"Link to project",
		]);
		if (index === undefined) return;
		if (index === 0 || index === 1) {
			const service = await ContextService.getOrInit();
			const result = await executeContextOperation(
				service,
				{ action: index === 0 ? "show" : "validate", target },
				getProjectDir(),
			);
			await this.#ctx.showHookCustom<void>(
				(ui, _theme, _keys, done) =>
					new ReportDetailsComponent(
						index === 0 ? "Context details" : "Connection result",
						`${target.name} · ${target.source}`,
						JSON.stringify(result, null, 2),
						() => done(),
						() => ui.terminal.rows,
					),
			);
		} else if (index === 2) await this.#edit(target);
		else await this.#guided(["", "", "", "namespace", "rename", "delete", "env", "link"][index], [], target);
	}
	async #manage(): Promise<void> {
		const labels = [
			"Create context",
			"Edit",
			"Rename",
			"Delete",
			"Project link",
			"Unlink project",
			"Environment",
			"Import bundle",
			"Export bundle",
		];
		const index = await this.#menu("Manage contexts", labels);
		if (index === 0) return this.#handleWizard();
		if (index === 1) return this.#edit();
		if (index !== undefined)
			await this.#guided(["", "", "rename", "delete", "link", "unlink", "env", "import", "export"][index]);
	}
	async #reviewOperation(op: ContextOperation): Promise<void> {
		const service = await ContextService.getOrInit();
		const cwd = getProjectDir();
		const prepare = async () => {
			const file = op.target ? service.targetPath(op.target) : undefined;
			const raw = file && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
			return {
				target: op,
				review: {
					identity: `context:${op.target?.source ?? "global"}:${op.target?.name ?? op.action}`,
					scope:
						op.target?.source === "local"
							? `Project-local configuration · ${cwd}`
							: "Global context configuration",
					revision: digest({
						raw,
						op,
						contexts: op.action === "import" ? await service.listContexts() : undefined,
					}),
					changes: [
						{ field: "Operation", before: "Saved configuration", after: op.action },
						...(op.newName
							? [
									{
										field: op.action === "link" ? "Linked global context" : "Name",
										before: op.target?.name ?? "Absent",
										after: op.newName,
									},
								]
							: []),
						...(op.namespace !== undefined
							? [
									{
										field: "Default namespace",
										before: op.target ? service.resolveTarget(op.target).defaultNamespace : "Absent",
										after: op.namespace,
									},
								]
							: []),
						...Object.entries(op.env ?? {}).map(([key, value]) => ({
							field: key,
							before: "Saved value",
							after:
								isSensitiveEnvKey(key) ||
								(op.target && service.resolveTarget(op.target).sensitiveKeys?.includes(key))
									? "Masked replacement"
									: value,
						})),
						...(op.unset ?? []).map(key => ({ field: key, before: "Saved value", after: "Removed" })),
						...(op.action === "import"
							? [
									{
										field: "Bundle",
										before: "Current global contexts",
										after: "Import global contexts; conflicting names require explicit overwrite",
									},
								]
							: []),
					],
					consequence: "Applies only the specified saved change. Credentials remain masked.",
				},
			};
		};
		const prepared = await prepare();
		await runReviewedAction(this.#ctx, "context change", {
			review: prepared.review,
			resolve: prepare,
			execute: async operation => {
				const result = await executeContextOperation(service, operation, cwd);
				if (result && typeof result === "object" && "status" in result && result.status !== "connected")
					throw new Error("Credential validation failed; saved configuration is unchanged.");
				this.#ctx.showStatus(`Saved ${op.target?.name ?? op.action}`);
			},
		});
	}
	async #guided(sub: string, args: string[] = [], selected?: ContextTarget): Promise<void> {
		const service = await ContextService.getOrInit();
		if (sub === "import") {
			const source = args[0] ?? (await this.#input("Import bundle", "Enter a file path or complete bundle JSON"));
			if (!source) return;
			let bundle: unknown;
			try {
				bundle = JSON.parse(source.startsWith("{") ? source : fs.readFileSync(expandTilde(source), "utf8"));
			} catch {
				this.#ctx.showError("Import must contain valid JSON.");
				return;
			}
			return this.#reviewOperation({ action: "import", bundle });
		}
		if (sub === "export") {
			const target =
				selected ?? (args[0] ? { name: args[0], source: "global" as const } : await this.#chooseTarget());
			if (!target) return;
			const result = await executeContextOperation(service, { action: "export", target }, getProjectDir());
			this.#ctx.showStatus(JSON.stringify(result, null, 2));
			return;
		}
		if (sub === "namespace") {
			const namespaces = service.getCachedNamespaces();
			const index = await this.#menu("Session namespace", [...namespaces, "Enter namespace"]);
			if (index === undefined) return;
			const value =
				index < namespaces.length
					? namespaces[index]
					: await this.#input(
							"Session namespace",
							"Applies to future turns",
							service.getStatus().activeContextNamespace ?? "default",
						);
			if (value) {
				service.setNamespace(value);
				this.#ctx.showStatus(`Namespace ${value} · future turns`);
			}
			return;
		}
		const target = selected ?? (args[0] ? { name: args[0], source: "global" as const } : await this.#chooseTarget());
		if (!target) return;
		if (sub === "validate") {
			const result = await executeContextOperation(service, { action: "validate", target }, getProjectDir());
			this.#ctx.showStatus(JSON.stringify(result, null, 2));
			return;
		}
		if (sub === "rename") {
			const newName = args[1] ?? (await this.#input("Rename context", `${target.name} · ${target.source}`));
			if (newName) await this.#reviewOperation({ action: "rename", target, newName });
			return;
		}
		if (sub === "delete") return this.#reviewOperation({ action: "delete", target, confirm: true });
		if (sub === "link") {
			const localName = await this.#input(
				"Project link name",
				`Links to global context ${target.name}`,
				target.name,
			);
			if (localName)
				await this.#reviewOperation({
					action: "link",
					target: { name: localName, source: "local" },
					newName: target.name,
				});
			return;
		}
		if (sub === "unlink") return this.#reviewOperation({ action: "unlink", target: { ...target, source: "local" } });
		const action = ["unset", "remove", "clear"].includes(sub)
			? 1
			: ["set", "add"].includes(sub)
				? 0
				: await this.#menu("Environment", ["Set variable", "Remove variable", "View variables"]);
		if (action === undefined) return;
		if (action === 2) {
			const result = await executeContextOperation(service, { action: "env", target }, getProjectDir());
			this.#ctx.showStatus(JSON.stringify(result, null, 2));
			return;
		}
		const key = await this.#input("Environment variable", "Non-reserved XCSH_ key");
		if (!key) return;
		if (action === 1) return this.#reviewOperation({ action: "env", target, unset: [key] });
		const value = await this.#input(`Value for ${key}`, "Saved on the selected context", "", isSensitiveEnvKey(key));
		if (value === undefined) return;
		return this.#reviewOperation({ action: "env", target, env: { [key]: value } });
	}
	async #edit(selected?: ContextTarget): Promise<void> {
		const service = await ContextService.getOrInit();
		let target = selected ?? (await this.#chooseTarget());
		if (!target) return;
		let file = service.targetPath(target);
		let original = fs.readFileSync(file, "utf8");
		const parsed = JSON.parse(original);
		if (target.source === "local" && typeof parsed.context === "string") {
			const action = await this.#menu("Edit project link", [
				"Local namespace",
				"Local environment",
				`Global URL/token · ${parsed.context}`,
			]);
			if (action === 0) {
				const value = await this.#input(
					"Default namespace",
					"Stored only in this project pointer",
					parsed.overrides?.defaultNamespace ?? "default",
				);
				if (value !== undefined) await this.#reviewOperation({ action: "edit", target, namespace: value });
				return;
			}
			if (action === 1) return this.#guided("env", [], target);
			if (action !== 2) return;
			target = { name: parsed.context, source: "global" };
			file = service.targetPath(target);
			original = fs.readFileSync(file, "utf8");
		}
		const context = service.resolveTarget(target);
		const editTarget = target;
		let savedDraft: string | undefined;
		await this.#openDraft(
			context,
			`${target.source} saved configuration · ${target.name}`,
			async (draft, activate) => {
				if (savedDraft && savedDraft !== digest(draft)) throw new Error("Draft changed after saving. Reopen Edit.");
				if (!savedDraft) {
					await service.saveTarget(editTarget, draft, original);
					savedDraft = digest(draft);
					original = fs.readFileSync(file, "utf8");
				}
				if (fs.readFileSync(file, "utf8") !== original) throw new Error("Saved context changed. Reopen Edit.");
				if (activate) await this.#activate(editTarget, false, false);
				else this.#ctx.showStatus(`Saved ${editTarget.name}`);
			},
		);
	}

	#invalidateIntegrations(): void {
		for (const handle of this.#ctx.session?.extensionRunner?.getAllRegisteredIntegrations() ?? [])
			handle.invalidate();
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
		report = Bun.stripANSI(report)
			.split("\n")
			.filter(line => !/^[╭╰]/.test(line))
			.map(line => line.replace(/^│\s?/, "").replace(/\s*│$/, ""))
			.join("\n");
		const action = command.args.trim() || "list";
		await this.#ctx.showHookCustom<void>(
			(ui, _theme, _keys, done) =>
				new ReportDetailsComponent(
					"Saved contexts",
					`/context ${action}`,
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

	async #openDraft(
		initial: XCSHContext | undefined,
		scope: string,
		save: (draft: XCSHContext, activate: boolean) => Promise<void>,
		prefill?: { name?: string; url?: string; token?: string },
	): Promise<void> {
		this.#draftActivated = false;
		await this.#ctx
			.showHookCustom<boolean>(
				(ui, _theme, _keys, done) =>
					new ContextAddWizard(
						async (draft, activate) => {
							await save(draft, activate);
							this.#draftActivated = activate;
							this.#invalidateIntegrations();
							done(!activate);
						},
						() => done(false),
						() => ui.requestRender(),
						{ initial, scope, prefill },
					),
			)
			.then(savedOnly => {
				if (savedOnly && !this.#pickerActive) void this.#picker();
			})
			.catch(error => this.#ctx.showError(error instanceof Error ? error.message : "Draft failed"));
	}

	async #handleWizard(prefill: string[] = []): Promise<void> {
		const service = await ContextService.getOrInit();
		let saved: string | undefined;
		let savedDraft: string | undefined;
		await this.#openDraft(
			undefined,
			"Global saved configuration",
			async (context, shouldActivate) => {
				if (!saved)
					await service.saveTarget(
						{ name: context.name, source: "global" },
						{ ...context, version: 1, metadata: { createdAt: new Date().toISOString() } },
						null,
					);
				if (savedDraft && savedDraft !== digest(context))
					throw new Error("Draft changed after saving. Reopen Edit to review the saved context.");
				savedDraft ??= digest(context);
				saved ??= fs.readFileSync(service.targetPath({ name: context.name, source: "global" }), "utf8");
				if (fs.readFileSync(service.targetPath({ name: context.name, source: "global" }), "utf8") !== saved)
					throw new Error("Saved context changed. Reopen the editor.");
				if (shouldActivate) await this.#activate({ name: context.name, source: "global" }, false, false);
				else this.#ctx.showStatus(`Saved ${context.name}`);
			},
			{ name: prefill[0], url: prefill[1], token: prefill[2] },
		);
	}
}
