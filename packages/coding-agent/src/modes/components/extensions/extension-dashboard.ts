import { createHash } from "node:crypto";
import { Container, Input, type MouseRoutable, type SgrMouseEvent, wrapTextWithAnsi } from "@f5-sales-demo/pi-tui";
import { Settings } from "../../../config/settings";
import { getAllProvidersInfo, getDisabledProviders, setDisabledProvidersRuntime } from "../../../discovery";
import { theme } from "../../../modes/theme/theme";
import type { ActionReview } from "../reviewed-action";
import { ReviewedActionDialog, type ReviewedActionOutcome } from "../reviewed-action-dialog";
import { matchesSelectorKey, selectorFrame, selectorFrameContentWidth, selectorRow } from "../selector-frame";
import { applyFilter, loadAllExtensions } from "./state-manager";
import { type Extension, makeQualifiedExtensionId, type ProviderTab } from "./types";

interface ProviderInfo {
	id: string;
	displayName: string;
	enabled: boolean;
}

export interface ExtensionDashboardDependencies {
	loadExtensions(cwd: string, disabledIds: string[]): Promise<Extension[]>;
	providers(): ProviderInfo[];
	getDisabledProviders(): string[];
	setDisabledProviders(ids: string[]): void;
}

const productionDependencies: ExtensionDashboardDependencies = {
	loadExtensions: (cwd, disabledIds) => loadAllExtensions(cwd, disabledIds),
	providers: () => getAllProvidersInfo(),
	getDisabledProviders,
	setDisabledProviders: setDisabledProvidersRuntime,
};

type DetailTarget = { kind: "extension"; identity: string } | { kind: "provider"; id: string };

function extensionIdentity(extension: Extension): string {
	return JSON.stringify([
		extension.kind,
		extension.name,
		extension.source.provider,
		extension.source.level,
		extension.path,
	]);
}

function persistedExtensionIdentity(extension: Extension): string {
	return makeQualifiedExtensionId(extension.kind, extension.name, extension.source, extension.path);
}

function revision(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function stateLabel(extension: Extension): string {
	if (extension.state === "active") return "Active";
	if (extension.state === "shadowed") return "Shadowed";
	return extension.disabledReason === "provider-disabled" ? "Provider disabled" : "Disabled";
}

function semantics(extension: Extension): string {
	switch (extension.kind) {
		case "prompt":
		case "slash-command":
			return "Prompt expansion: invoking this item expands stored text into the editor; it does not execute until submitted.";
		case "skill":
		case "rule":
		case "context-file":
		case "instruction":
			return "Context contribution: this item supplies instructions or context; opening it here never executes code.";
		case "tool":
		case "hook":
		case "mcp":
		case "extension-module":
			return "Execution capability: the loaded item can execute when its owning workflow invokes it; opening it here never invokes it.";
	}
}

function tabsFor(extensions: Extension[], providers: ProviderInfo[], previous: ProviderTab[] = []): ProviderTab[] {
	const counts = new Map<string, number>();
	for (const extension of extensions)
		counts.set(extension.source.provider, (counts.get(extension.source.provider) ?? 0) + 1);
	const all: ProviderTab[] = [
		{ id: "all", label: "All", enabled: true, count: extensions.length },
		...providers
			.filter(provider => provider.id !== "native")
			.map(provider => ({
				id: provider.id,
				label: provider.displayName,
				enabled: provider.enabled,
				count: counts.get(provider.id) ?? 0,
			})),
	];
	if (!previous.length) return all;
	const order = new Map(previous.map((tab, index) => [tab.id, index]));
	return all.sort(
		(a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
	);
}

/** Single-column extension inventory with inspect-before-mutate reviewed actions. */
export class ExtensionDashboard extends Container implements MouseRoutable {
	#extensions: Extension[] = [];
	#tabs: ProviderTab[] = [];
	#activeTab = "all";
	#search = new Input();
	#selection = new Map<string, string>();
	#query = new Map<string, string>();
	#details: DetailTarget | null = null;
	#actionIndex = 0;
	#detailOffset = 0;
	#detailCapacity = 1;
	#detailLength = 0;
	#review: ReviewedActionDialog<unknown> | null = null;
	#loading = false;
	#notice = "";
	#noticeTone: "success" | "warning" | "error" | "muted" = "muted";
	#refreshGeneration = 0;
	#clickRows = new Map<number, string>();
	#lastLines: string[] = [];

	onClose?: () => void;
	onRequestRender?: () => void;

	private constructor(
		private readonly cwd: string,
		private readonly settings: Settings,
		private readonly getTerminalHeight: () => number,
		private readonly dependencies: ExtensionDashboardDependencies,
	) {
		super();
	}

	static async create(
		cwd: string,
		settings: Settings | null = null,
		terminalHeight?: number | (() => number),
		dependencies: ExtensionDashboardDependencies = productionDependencies,
	): Promise<ExtensionDashboard> {
		const dashboard = new ExtensionDashboard(
			cwd,
			settings ?? (await Settings.init()),
			typeof terminalHeight === "function" ? terminalHeight : () => terminalHeight ?? process.stdout.rows ?? 24,
			dependencies,
		);
		await dashboard.#refresh("initial");
		return dashboard;
	}

	#activeTabInfo(): ProviderTab | undefined {
		return this.#tabs.find(tab => tab.id === this.#activeTab);
	}

	#filtered(): Extension[] {
		const scoped =
			this.#activeTab === "all"
				? this.#extensions
				: this.#extensions.filter(extension => extension.source.provider === this.#activeTab);
		return applyFilter(scoped, this.#search.getValue());
	}

	#selectedExtension(): Extension | undefined {
		const items = this.#filtered();
		const identity = this.#selection.get(this.#activeTab);
		return items.find(item => extensionIdentity(item) === identity) ?? items[0];
	}

	#rememberSelection(extension: Extension | undefined): void {
		if (extension) this.#selection.set(this.#activeTab, extensionIdentity(extension));
	}

	async #refresh(reason: "initial" | "manual" | "mutation"): Promise<void> {
		const generation = ++this.#refreshGeneration;
		this.#loading = true;
		if (reason === "manual") {
			this.#notice = "Refreshing extension inventory…";
			this.#noticeTone = "muted";
		}
		this.onRequestRender?.();
		try {
			const extensions = await this.dependencies.loadExtensions(
				this.cwd,
				(this.settings.get("disabledExtensions") as string[]) ?? [],
			);
			if (generation !== this.#refreshGeneration) return;
			this.#extensions = extensions;
			this.#tabs = tabsFor(extensions, this.dependencies.providers(), this.#tabs);
			if (!this.#tabs.some(tab => tab.id === this.#activeTab)) this.#activeTab = "all";
			this.#rememberSelection(this.#selectedExtension());
			if (reason === "manual") {
				this.#notice = "Extension inventory refreshed.";
				this.#noticeTone = "success";
			}
		} catch (error) {
			if (generation !== this.#refreshGeneration) return;
			this.#notice = `Refresh failed: ${error instanceof Error ? error.message : String(error)}`;
			this.#noticeTone = "error";
		} finally {
			if (generation === this.#refreshGeneration) this.#loading = false;
			this.onRequestRender?.();
		}
	}

	#switchTab(direction: 1 | -1): void {
		if (!this.#tabs.length) return;
		this.#query.set(this.#activeTab, this.#search.getValue());
		const index = Math.max(
			0,
			this.#tabs.findIndex(tab => tab.id === this.#activeTab),
		);
		this.#activeTab = this.#tabs[(index + direction + this.#tabs.length) % this.#tabs.length]!.id;
		this.#search.setValue(this.#query.get(this.#activeTab) ?? "");
		this.#rememberSelection(this.#selectedExtension());
		this.#detailOffset = 0;
	}

	#extensionReview(extension: Extension): ActionReview {
		const saved = (this.settings.get("disabledExtensions") as string[]) ?? [];
		const qualified = persistedExtensionIdentity(extension);
		const disabled = saved.includes(qualified) || saved.includes(extension.id);
		return {
			identity: `extension:${extensionIdentity(extension)}`,
			scope: `${extension.source.level} extension settings · provider ${extension.source.provider}`,
			revision: revision({
				identity: extensionIdentity(extension),
				state: extension.state,
				description: extension.description,
				trigger: extension.trigger,
				shadowedBy: extension.shadowedBy,
				raw: extension.raw,
				disabled,
				disabledExtensions: saved,
			}),
			changes: [
				{
					field: "Enabled override",
					before: disabled ? "Disabled" : "Enabled",
					after: disabled ? "Enabled" : "Disabled",
				},
			],
			consequence: `${disabled ? "Enables" : "Disables"} only this ${extension.kind} identity. Provider state, shadowing, and project precedence remain separate; reload may be required before runtime use changes.`,
		};
	}

	#providerReview(provider: ProviderTab): ActionReview {
		const disabled = new Set(this.dependencies.getDisabledProviders());
		const enabled = !disabled.has(provider.id);
		return {
			identity: `provider:${provider.id}`,
			scope: "user discovery provider settings",
			revision: revision({ id: provider.id, enabled, disabled: [...disabled].sort() }),
			changes: [
				{
					field: "Provider enabled",
					before: enabled ? "Enabled" : "Disabled",
					after: enabled ? "Disabled" : "Enabled",
				},
			],
			consequence: `${enabled ? "Disables" : "Enables"} discovery for this provider across skills, tools, commands, hooks, prompts, context, and MCP definitions. Item overrides remain stored and a reload may be required.`,
		};
	}

	async #persistSetting(
		path: "disabledExtensions" | "disabledProviders",
		before: string[],
		after: string[],
	): Promise<void> {
		this.settings.set(path, after);
		try {
			await this.settings.flush({ throwOnError: true });
		} catch (error) {
			this.settings.set(path, before);
			try {
				await this.settings.flush({ throwOnError: true });
			} catch {
				// The original state remains the desired retry target; keep the primary error.
			}
			throw error;
		}
	}

	#openExtensionReview(extension: Extension): void {
		const reviewedIdentity = extensionIdentity(extension);
		const review = this.#extensionReview(extension);
		this.#review = new ReviewedActionDialog(
			extension.state === "disabled" ? "enable extension" : "disable extension",
			{
				review,
				resolve: async () => {
					const extensions = await this.dependencies.loadExtensions(
						this.cwd,
						(this.settings.get("disabledExtensions") as string[]) ?? [],
					);
					const current = extensions.find(item => extensionIdentity(item) === reviewedIdentity);
					return current ? { review: this.#extensionReview(current), target: current } : undefined;
				},
				execute: async target => {
					const current = target as Extension;
					const before = [...((this.settings.get("disabledExtensions") as string[]) ?? [])];
					const disabled = new Set(before);
					const qualified = persistedExtensionIdentity(current);
					if (disabled.has(qualified) || disabled.has(current.id)) {
						disabled.delete(qualified);
						disabled.delete(current.id);
					} else disabled.add(qualified);
					await this.#persistSetting("disabledExtensions", before, [...disabled].sort());
				},
			},
			outcome => this.#finishReview(outcome, extension.displayName),
			() => this.onRequestRender?.(),
			this.getTerminalHeight,
		);
	}

	#openProviderReview(provider: ProviderTab): void {
		const review = this.#providerReview(provider);
		this.#review = new ReviewedActionDialog(
			provider.enabled ? "disable provider" : "enable provider",
			{
				review,
				resolve: async () => {
					const current = tabsFor(this.#extensions, this.dependencies.providers()).find(
						tab => tab.id === provider.id,
					);
					return current ? { review: this.#providerReview(current), target: current } : undefined;
				},
				execute: async target => {
					const current = target as ProviderTab;
					const before = [...this.dependencies.getDisabledProviders()].sort();
					const disabled = new Set(before);
					if (disabled.has(current.id)) disabled.delete(current.id);
					else disabled.add(current.id);
					const after = [...disabled].sort();
					await this.#persistSetting("disabledProviders", before, after);
					this.dependencies.setDisabledProviders(after);
				},
			},
			outcome => this.#finishReview(outcome, provider.label),
			() => this.onRequestRender?.(),
			this.getTerminalHeight,
		);
	}

	#finishReview(outcome: ReviewedActionOutcome, label: string): void {
		this.#review = null;
		if (outcome === "succeeded") {
			this.#notice = `Saved extension state for ${label}.`;
			this.#noticeTone = "success";
			void this.#refresh("mutation");
		} else if (outcome === "interrupted") {
			this.#notice = `Extension change for ${label} was interrupted.`;
			this.#noticeTone = "warning";
		}
		this.onRequestRender?.();
	}

	#detailsTarget(): Extension | ProviderTab | undefined {
		const details = this.#details;
		if (!details) return undefined;
		if (details.kind === "provider") return this.#tabs.find(tab => tab.id === details.id);
		return this.#extensions.find(extension => extensionIdentity(extension) === details.identity);
	}

	override render(width: number): string[] {
		if (this.#review) return this.#review.render(width);
		const inner = selectorFrameContentWidth(width);
		const height = this.getTerminalHeight();
		if (this.#details) {
			const target = this.#detailsTarget();
			if (!target) {
				this.#details = null;
				return this.render(width);
			}
			const provider = "count" in target;
			const actions = provider
				? [`${target.enabled ? "Disable" : "Enable"} provider`]
				: [
						`${
							[...((this.settings.get("disabledExtensions") as string[]) ?? [])].some(
								id => id === target.id || id === persistedExtensionIdentity(target),
							)
								? "Enable"
								: "Disable"
						} extension`,
						...(target.source.provider === "native" ? [] : [`Manage provider: ${target.source.providerName}`]),
					];
			const details = provider
				? [
						`Identifier: ${target.id}`,
						`Saved state: ${target.enabled ? "Enabled" : "Disabled"}`,
						`Discovered items: ${target.count}`,
						"Provider state controls discovery across capability kinds; item overrides remain separate.",
					]
				: [
						`Identifier: ${target.kind}:${target.name}`,
						`Provider: ${target.source.providerName} (${target.source.provider})`,
						`Scope: ${target.source.level}`,
						`Status: ${stateLabel(target)}${target.disabledReason ? ` · ${target.disabledReason}` : ""}`,
						`Path: ${target.path}`,
						target.trigger ? `Trigger: ${target.trigger}` : "",
						target.shadowedBy ? `Shadowed by: ${target.shadowedBy}` : "",
						target.description ?? "",
						semantics(target),
					];
			const wrapped = details.flatMap(line => (line ? wrapTextWithAnsi(line, inner) : []));
			this.#detailCapacity = Math.max(1, height - 11 - actions.length);
			this.#detailLength = wrapped.length;
			this.#detailOffset = Math.min(this.#detailOffset, Math.max(0, wrapped.length - this.#detailCapacity));
			this.#lastLines = selectorFrame(
				width,
				height,
				provider ? "Provider details" : "Extension details",
				provider ? target.label : target.displayName,
				[],
				actions.map((action, index) => selectorRow([action], [inner - 2], index === this.#actionIndex)),
				wrapped.slice(this.#detailOffset, this.#detailOffset + this.#detailCapacity),
				[
					...(this.#notice ? [theme.fg(this.#noticeTone, this.#notice)] : []),
					...(wrapped.length > this.#detailCapacity ? ["PgUp/PgDn: details"] : []),
					"Esc: back",
				],
				{ selectedBodyIndex: this.#actionIndex },
			);
			this.#mapClickRows(actions);
			return this.#lastLines;
		}

		const tab = this.#activeTabInfo();
		const extensions = this.#filtered();
		const selected = this.#selectedExtension();
		this.#rememberSelection(selected);
		const providerRow = tab && tab.id !== "all" ? [`Manage provider: ${tab.label}`] : [];
		const rows = [
			...providerRow.map(label =>
				selectorRow([label, tab!.enabled ? "Enabled" : "Disabled"], [Math.max(1, inner - 14), 10], false),
			),
			...extensions.map(extension =>
				selectorRow(
					[
						extension.displayName,
						`${extension.kind} · ${stateLabel(extension)}`,
						`${extension.source.provider}/${extension.source.level}`,
					],
					[
						Math.max(1, Math.floor(inner * 0.36)),
						Math.max(1, Math.floor(inner * 0.34)),
						Math.max(1, inner - Math.floor(inner * 0.7) - 6),
					],
					extension === selected,
				),
			),
		];
		const noResults = !extensions.length
			? [
					this.#extensions.length
						? `No extensions match “${this.#search.getValue()}”.`
						: "No extensions are available.",
				]
			: [];
		const tabLine = this.#tabs
			.map(
				item =>
					`${item.id === this.#activeTab ? "[" : ""}${item.label} (${item.count})${item.id === this.#activeTab ? "]" : ""}`,
			)
			.join("  ");
		const selectedIndex = selected ? providerRow.length + extensions.indexOf(selected) : 0;
		const selectedDetails = selected
			? `${selected.kind}:${selected.name} · ${selected.source.provider}/${selected.source.level} · ${stateLabel(selected)}`
			: "";
		this.#lastLines = selectorFrame(
			width,
			height,
			"Extension control center",
			"Inspect discovered capabilities before changing saved enablement",
			[
				...wrapTextWithAnsi(tabLine, inner),
				...this.#search.render(Math.max(1, inner - 8)).map(line => `Search: ${line}`),
			],
			rows.length ? rows : noResults,
			[
				selectedDetails,
				this.#notice ? theme.fg(this.#noticeTone, this.#notice) : "",
				this.#loading ? theme.fg("muted", "Refreshing while cached results remain available…") : "",
			],
			["Tab/Shift+Tab: provider", "Ctrl+R: refresh", "Esc: back"],
			{ selectedBodyIndex: selectedIndex, overflowHint: "PgUp/PgDn: more extensions" },
		);
		this.#mapClickRows([...providerRow, ...extensions.map(extension => extensionIdentity(extension))]);
		return this.#lastLines;
	}

	#mapClickRows(keys: string[]): void {
		this.#clickRows.clear();
		if (this.#details) {
			for (let line = 0; line < this.#lastLines.length; line++) {
				const plain = Bun.stripANSI(this.#lastLines[line] ?? "");
				const index = keys.findIndex(key => plain.includes(key));
				if (index >= 0) this.#clickRows.set(line, `action:${index}`);
			}
			return;
		}
		const tab = this.#activeTabInfo();
		for (let line = 0; line < this.#lastLines.length; line++) {
			const plain = Bun.stripANSI(this.#lastLines[line] ?? "");
			if (tab && tab.id !== "all" && plain.includes(`Manage provider: ${tab.label}`)) {
				this.#clickRows.set(line, `provider:${tab.id}`);
				continue;
			}
			for (const extension of this.#filtered()) {
				if (plain.includes(extension.displayName) && plain.includes(extension.kind)) {
					this.#clickRows.set(line, extensionIdentity(extension));
					break;
				}
			}
		}
	}

	handleInput(data: string): void {
		if (this.#review) {
			this.#review.handleInput(data);
			return;
		}
		if (data === "\x03") return;
		if (this.#details) {
			if (matchesSelectorKey(data, "cancel")) {
				this.#details = null;
				this.#detailOffset = 0;
				this.#actionIndex = 0;
			} else if (matchesSelectorKey(data, "up") || matchesSelectorKey(data, "down")) {
				const target = this.#detailsTarget();
				const count = target && !("count" in target) && target.source.provider !== "native" ? 2 : 1;
				const delta = matchesSelectorKey(data, "up") ? -1 : 1;
				this.#actionIndex = (this.#actionIndex + delta + count) % count;
			} else if (matchesSelectorKey(data, "pageDown"))
				this.#detailOffset = Math.min(
					Math.max(0, this.#detailLength - this.#detailCapacity),
					this.#detailOffset + this.#detailCapacity,
				);
			else if (matchesSelectorKey(data, "pageUp"))
				this.#detailOffset = Math.max(0, this.#detailOffset - this.#detailCapacity);
			else if (matchesSelectorKey(data, "confirm")) {
				const target = this.#detailsTarget();
				if (target && "count" in target) this.#openProviderReview(target);
				else if (target && this.#actionIndex === 0) this.#openExtensionReview(target);
				else if (target) {
					const provider = this.#tabs.find(tab => tab.id === target.source.provider);
					if (provider) {
						this.#details = { kind: "provider", id: provider.id };
						this.#actionIndex = 0;
						this.#detailOffset = 0;
					}
				}
			}
			this.onRequestRender?.();
			return;
		}
		if (data === "\x12") {
			void this.#refresh("manual");
			return;
		}
		if (data === "\t" || data === "\x1b[Z") {
			this.#switchTab(data === "\t" ? 1 : -1);
			this.onRequestRender?.();
			return;
		}
		if (matchesSelectorKey(data, "cancel")) {
			if (this.#search.getValue()) {
				this.#search.setValue("");
				this.#query.set(this.#activeTab, "");
				this.#rememberSelection(this.#selectedExtension());
			} else this.onClose?.();
		} else if (matchesSelectorKey(data, "up") || matchesSelectorKey(data, "down")) {
			const items = this.#filtered();
			if (items.length) {
				const selected = this.#selectedExtension();
				const index = Math.max(0, selected ? items.indexOf(selected) : 0);
				const delta = matchesSelectorKey(data, "up") ? -1 : 1;
				this.#rememberSelection(items[(index + delta + items.length) % items.length]);
			}
		} else if (matchesSelectorKey(data, "confirm")) {
			const selected = this.#selectedExtension();
			if (selected) this.#details = { kind: "extension", identity: extensionIdentity(selected) };
			else {
				const tab = this.#activeTabInfo();
				if (tab && tab.id !== "all") this.#details = { kind: "provider", id: tab.id };
			}
		} else {
			const before = this.#search.getValue();
			this.#search.handleInput(data);
			if (before !== this.#search.getValue()) {
				this.#query.set(this.#activeTab, this.#search.getValue());
				this.#rememberSelection(this.#selectedExtension());
			}
		}
		this.onRequestRender?.();
	}

	routeMouse(event: SgrMouseEvent, line: number): void {
		if (this.#review || event.release) return;
		if (event.wheel !== null) {
			this.handleInput(event.wheel > 0 ? "\x1b[B" : "\x1b[A");
			return;
		}
		if (!event.leftClick) return;
		const key = this.#clickRows.get(line);
		if (!key) return;
		if (key.startsWith("action:")) this.handleInput("\r");
		else if (key.startsWith("provider:")) {
			this.#details = { kind: "provider", id: key.slice(9) };
			this.onRequestRender?.();
		} else {
			const alreadySelected = this.#selection.get(this.#activeTab) === key;
			this.#selection.set(this.#activeTab, key);
			if (alreadySelected) this.#details = { kind: "extension", identity: key };
			this.onRequestRender?.();
		}
	}
}
