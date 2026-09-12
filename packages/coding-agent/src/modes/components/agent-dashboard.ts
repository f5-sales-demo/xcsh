import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import {
	Container,
	Input,
	type MouseRoutable,
	replaceTabs,
	type SgrMouseEvent,
	wrapTextWithAnsi,
} from "@f5-sales-demo/pi-tui";
import { isEnoent, prompt } from "@f5-sales-demo/pi-utils";
import { YAML } from "bun";
import { getConfigDirs } from "../../config";
import type { ModelRegistry } from "../../config/model-registry";
import {
	formatModelString,
	resolveAgentModelPatterns,
	resolveConfiguredModelPatterns,
	resolveModelOverride,
} from "../../config/model-resolver";
import { Settings } from "../../config/settings";
import agentCreationArchitectPrompt from "../../prompts/system/agent-creation-architect.md" with { type: "text" };
import agentCreationUserPrompt from "../../prompts/system/agent-creation-user.md" with { type: "text" };
import { createAgentSession } from "../../sdk";
import { discoverAgents } from "../../task/discovery";
import type { AgentDefinition, AgentSource } from "../../task/types";
import { theme } from "../theme/theme";
import type { ActionReview } from "./reviewed-action";
import { ReviewedActionDialog, type ReviewedActionOutcome } from "./reviewed-action-dialog";
import { matchesSelectorKey, selectorFrame, selectorFrameContentWidth, selectorRow } from "./selector-frame";
import { SettingsTextEditor } from "./settings-editors";

type SourceTabId = "all" | AgentSource;
type AgentScope = "project" | "user";

interface SourceTab {
	id: SourceTabId;
	label: string;
	count: number;
}

interface DashboardAgent extends AgentDefinition {
	disabled: boolean;
	overrideModel?: string;
}

interface ModelResolution {
	resolved: string;
	thinkingLevel?: string;
	explicitThinkingLevel: boolean;
}

interface AgentCreationTarget {
	directory: string;
	file: string;
	content: string;
}

export interface GeneratedAgentSpec {
	identifier: string;
	whenToUse: string;
	systemPrompt: string;
}

interface AgentDashboardModelContext {
	modelRegistry?: ModelRegistry;
	activeModelPattern?: string;
	defaultModelPattern?: string;
}

export interface AgentDashboardDependencies {
	discover(cwd: string): Promise<{ agents: AgentDefinition[] }>;
	resolveDirectory(cwd: string, scope: AgentScope): string | undefined;
	stat(file: string): Promise<unknown>;
	mkdir(directory: string): Promise<void>;
	writeExclusive(file: string, content: string): Promise<void>;
	generate?(description: string): Promise<GeneratedAgentSpec>;
}

const productionDependencies: AgentDashboardDependencies = {
	discover: cwd => discoverAgents(cwd),
	resolveDirectory: (cwd, scope) =>
		getConfigDirs("agents", { user: scope === "user", project: scope === "project", cwd })[0]?.path,
	stat: file => fs.stat(file),
	mkdir: async directory => {
		await fs.mkdir(directory, { recursive: true });
	},
	writeExclusive: (file, content) => fs.writeFile(file, content, { flag: "wx", mode: 0o600 }),
};

const SOURCE_LABEL: Record<AgentSource, string> = { project: "Project", user: "User", bundled: "Bundled" };
const SOURCE_ORDER: Record<AgentSource, number> = { project: 0, user: 1, bundled: 2 };
const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+){1,5}$/;
const CREATE_AGENT_IDENTITY = "__create_agent__";

function agentIdentity(agent: AgentDefinition): string {
	return JSON.stringify([agent.name, agent.source, agent.filePath ?? "bundled"]);
}

function revision(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseGeneratedAgentSpec(raw: string): GeneratedAgentSpec {
	const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
	const start = raw.indexOf("{");
	const end = raw.lastIndexOf("}");
	const parsed = JSON.parse(
		fenced ?? (start >= 0 && end >= start ? raw.slice(start, end + 1) : raw),
	) as Partial<GeneratedAgentSpec>;
	const identifier = parsed.identifier?.trim() ?? "";
	const whenToUse = parsed.whenToUse?.trim() ?? "";
	const systemPrompt = parsed.systemPrompt?.trim() ?? "";
	if (!IDENTIFIER_PATTERN.test(identifier))
		throw new Error("Generated identifier is invalid (use lowercase kebab-case with at least two words). ");
	if (!whenToUse.toLowerCase().startsWith("use this agent when"))
		throw new Error("Generated whenToUse must start with 'Use this agent when...'.");
	if (!systemPrompt) throw new Error("Generated systemPrompt is empty.");
	return { identifier, whenToUse, systemPrompt };
}

function extractAssistantText(messages: AgentMessage[]): string | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
		const text = message.content
			.map(block =>
				block && typeof block === "object" && "type" in block && block.type === "text" && "text" in block
					? String(block.text)
					: "",
			)
			.join("\n")
			.trim();
		if (text) return text;
	}
}

function agentFileContent(spec: GeneratedAgentSpec): string {
	const frontmatter = YAML.stringify({ name: spec.identifier, description: spec.whenToUse }).trimEnd();
	return `---\n${frontmatter}\n---\n\n${spec.systemPrompt.trim()}\n`;
}

/** Inspectable, scope-qualified agent manager. Persistent changes always pass through review. */
export class AgentDashboard extends Container implements MouseRoutable {
	#settings: Settings;
	#all: DashboardAgent[] = [];
	#tabs: SourceTab[] = [];
	#activeTab: SourceTabId = "all";
	#search = new Input();
	#queries = new Map<SourceTabId, string>();
	#selections = new Map<SourceTabId, string>();
	#detailsIdentity: string | null = null;
	#actionIndex = 0;
	#detailOffset = 0;
	#detailCapacity = 1;
	#detailLength = 0;
	#review: ReviewedActionDialog<unknown> | null = null;
	#editor: SettingsTextEditor | null = null;
	#createScope: AgentScope | null = null;
	#createScopeChoice = false;
	#createScopeChoiceIndex = 0;
	#createDescription = "";
	#createGenerating = false;
	#createError = "";
	#loading = false;
	#loadGeneration = 0;
	#notice = "";
	#noticeTone: "success" | "warning" | "error" | "muted" = "muted";
	#lastLines: string[] = [];
	#clickRows = new Map<number, string>();

	onClose?: () => void;
	onRequestRender?: () => void;

	private constructor(
		private readonly cwd: string,
		settings: Settings,
		private readonly terminalHeight: () => number,
		private readonly modelContext: AgentDashboardModelContext,
		private readonly dependencies: AgentDashboardDependencies,
	) {
		super();
		this.#settings = settings;
	}

	static async create(
		cwd: string,
		settings: Settings | null = null,
		terminalHeight?: number | (() => number),
		modelContext: AgentDashboardModelContext = {},
		dependencies: AgentDashboardDependencies = productionDependencies,
	): Promise<AgentDashboard> {
		const dashboard = new AgentDashboard(
			cwd,
			settings ?? (await Settings.init()),
			typeof terminalHeight === "function" ? terminalHeight : () => terminalHeight ?? process.stdout.rows ?? 24,
			modelContext,
			dependencies,
		);
		await dashboard.#reload("initial");
		return dashboard;
	}

	#buildTabs(): SourceTab[] {
		const counts: Record<AgentSource, number> = { project: 0, user: 0, bundled: 0 };
		for (const agent of this.#all) counts[agent.source]++;
		return [
			{ id: "all", label: "All", count: this.#all.length },
			{ id: "project", label: "Project", count: counts.project },
			{ id: "user", label: "User", count: counts.user },
			{ id: "bundled", label: "Bundled", count: counts.bundled },
		];
	}

	#filtered(): DashboardAgent[] {
		const query = this.#search.getValue().trim().toLocaleLowerCase();
		return this.#all.filter(agent => {
			if (this.#activeTab !== "all" && agent.source !== this.#activeTab) return false;
			return (
				!query ||
				`${agent.name} ${agent.description} ${agent.source} ${agent.overrideModel ?? ""}`
					.toLocaleLowerCase()
					.includes(query)
			);
		});
	}

	#selected(): DashboardAgent | undefined {
		const items = this.#filtered();
		const identity = this.#selections.get(this.#activeTab);
		if (identity === CREATE_AGENT_IDENTITY) return undefined;
		return items.find(agent => agentIdentity(agent) === identity) ?? items[0];
	}

	#remember(agent: DashboardAgent | undefined): void {
		if (agent) this.#selections.set(this.#activeTab, agentIdentity(agent));
	}

	#detailsAgent(): DashboardAgent | undefined {
		return this.#detailsIdentity
			? this.#all.find(agent => agentIdentity(agent) === this.#detailsIdentity)
			: undefined;
	}

	async #reload(reason: "initial" | "manual" | "mutation"): Promise<void> {
		const generation = ++this.#loadGeneration;
		this.#loading = true;
		if (reason === "manual") {
			this.#notice = "Refreshing agent inventory…";
			this.#noticeTone = "muted";
		}
		this.onRequestRender?.();
		try {
			const selectedIdentity =
				this.#detailsIdentity ?? (this.#selected() ? agentIdentity(this.#selected()!) : undefined);
			const { agents } = await this.dependencies.discover(this.cwd);
			if (generation !== this.#loadGeneration) return;
			const disabled = new Set((this.#settings.get("task.disabledAgents") as string[]) ?? []);
			const overrides = this.#settings.get("task.agentModelOverrides") ?? {};
			this.#all = agents
				.slice()
				.sort((a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || a.name.localeCompare(b.name))
				.map(agent => ({
					...agent,
					disabled: disabled.has(agent.name),
					overrideModel: overrides[agent.name]?.trim() || undefined,
				}));
			this.#tabs = this.#buildTabs();
			if (selectedIdentity) {
				const selected = this.#all.find(agent => agentIdentity(agent) === selectedIdentity);
				if (selected) {
					this.#selections.set(this.#activeTab, selectedIdentity);
					if (this.#detailsIdentity) this.#detailsIdentity = selectedIdentity;
				} else this.#detailsIdentity = null;
			}
			this.#remember(this.#selected());
			if (reason === "manual") {
				this.#notice = "Agent inventory refreshed.";
				this.#noticeTone = "success";
			}
		} catch (error) {
			if (generation !== this.#loadGeneration) return;
			this.#notice = `Refresh failed: ${error instanceof Error ? error.message : String(error)}`;
			this.#noticeTone = "error";
		} finally {
			if (generation === this.#loadGeneration) this.#loading = false;
			this.onRequestRender?.();
		}
	}

	#switchTab(direction: 1 | -1): void {
		this.#queries.set(this.#activeTab, this.#search.getValue());
		const index = Math.max(
			0,
			this.#tabs.findIndex(tab => tab.id === this.#activeTab),
		);
		this.#activeTab = this.#tabs[(index + direction + this.#tabs.length) % this.#tabs.length]!.id;
		this.#search.setValue(this.#queries.get(this.#activeTab) ?? "");
		this.#remember(this.#selected());
	}

	#defaultPatterns(agent: DashboardAgent): string[] {
		return resolveAgentModelPatterns({
			agentModel: agent.model,
			settings: this.#settings,
			activeModelPattern: this.modelContext.activeModelPattern,
			fallbackModelPattern: this.modelContext.defaultModelPattern,
		});
	}

	#effectivePatterns(agent: DashboardAgent, override = agent.overrideModel): string[] {
		return resolveAgentModelPatterns({
			settingsOverride: override,
			agentModel: agent.model,
			settings: this.#settings,
			activeModelPattern: this.modelContext.activeModelPattern,
			fallbackModelPattern: this.modelContext.defaultModelPattern,
		});
	}

	#resolve(patterns: string[]): ModelResolution | undefined {
		if (!this.modelContext.modelRegistry || !patterns.length) return undefined;
		const { model, thinkingLevel, explicitThinkingLevel } = resolveModelOverride(
			patterns,
			this.modelContext.modelRegistry,
			this.#settings,
		);
		return model ? { resolved: formatModelString(model), thinkingLevel, explicitThinkingLevel } : undefined;
	}

	async #persistSetting(
		path: "task.disabledAgents" | "task.agentModelOverrides",
		before: string[] | Record<string, string>,
		after: string[] | Record<string, string>,
	): Promise<void> {
		this.#settings.set(path as never, after as never);
		try {
			await this.#settings.flush({ throwOnError: true });
		} catch (error) {
			this.#settings.set(path as never, before as never);
			try {
				await this.#settings.flush({ throwOnError: true });
			} catch {
				// Preserve the original desired value for a later explicit retry.
			}
			throw error;
		}
	}

	#agentReview(agent: DashboardAgent, kind: "enabled" | "model", proposedModel?: string): ActionReview {
		const disabled = (this.#settings.get("task.disabledAgents") as string[]) ?? [];
		const overrides = this.#settings.get("task.agentModelOverrides") ?? {};
		const beforeModel = overrides[agent.name]?.trim() || "(none)";
		const afterModel = proposedModel?.trim() || "(none)";
		return {
			identity: `agent:${agentIdentity(agent)}`,
			scope: `user defaults · effective ${agent.source} agent`,
			revision: revision({ agent, disabled, overrides, kind, proposedModel: afterModel }),
			changes:
				kind === "enabled"
					? [
							{
								field: "Enabled",
								before: disabled.includes(agent.name) ? "Disabled" : "Enabled",
								after: disabled.includes(agent.name) ? "Enabled" : "Disabled",
							},
						]
					: [
							{ field: "Model override", before: beforeModel, after: afterModel },
							{
								field: "Effective model",
								before: this.#resolve(this.#effectivePatterns(agent))?.resolved ?? "Unresolved",
								after: this.#resolve(this.#effectivePatterns(agent, proposedModel))?.resolved ?? "Unresolved",
							},
						],
			consequence:
				kind === "enabled"
					? "Changes whether the effective named agent is offered to future task calls. Existing running agents are unaffected."
					: "Changes the saved user model pattern for future runs of this named agent. Project/source precedence and currently running agents are unaffected.",
		};
	}

	#openEnabledReview(agent: DashboardAgent): void {
		const identity = agentIdentity(agent);
		const review = this.#agentReview(agent, "enabled");
		this.#review = new ReviewedActionDialog(
			agent.disabled ? "enable agent" : "disable agent",
			{
				review,
				resolve: async () => {
					const fresh = await this.dependencies.discover(this.cwd);
					const definition = fresh.agents.find(candidate => agentIdentity(candidate) === identity);
					if (!definition) return undefined;
					const current: DashboardAgent = {
						...definition,
						disabled: ((this.#settings.get("task.disabledAgents") as string[]) ?? []).includes(definition.name),
						overrideModel: this.#settings.get("task.agentModelOverrides")[definition.name],
					};
					return { review: this.#agentReview(current, "enabled"), target: current };
				},
				execute: async target => {
					const current = target as DashboardAgent;
					const before = [...((this.#settings.get("task.disabledAgents") as string[]) ?? [])];
					const disabled = new Set(before);
					if (disabled.has(current.name)) disabled.delete(current.name);
					else disabled.add(current.name);
					await this.#persistSetting("task.disabledAgents", before, [...disabled].sort());
				},
			},
			outcome => this.#finishReview(outcome, agent.name),
			() => this.onRequestRender?.(),
			this.terminalHeight,
		);
	}

	#beginModelEdit(agent: DashboardAgent): void {
		this.#editor = new SettingsTextEditor(
			`Model override: ${agent.name}`,
			`Saved user default · Current source: ${agent.source} · Empty clears the override`,
			agent.overrideModel ?? "",
			value => this.#prepareModelReview(agent, value.trim()),
			() => {
				this.#editor = null;
				this.onRequestRender?.();
			},
		);
	}

	#prepareModelReview(agent: DashboardAgent, proposed: string): void {
		const current = this.#settings.get("task.agentModelOverrides")[agent.name]?.trim() ?? "";
		if (current === proposed) {
			this.#editor = null;
			this.#notice = `Model override for ${agent.name} is unchanged; nothing saved.`;
			this.#noticeTone = "muted";
			this.onRequestRender?.();
			return;
		}
		const identity = agentIdentity(agent);
		const review = this.#agentReview(agent, "model", proposed);
		this.#editor = null;
		this.#review = new ReviewedActionDialog(
			"agent model override",
			{
				review,
				resolve: async () => {
					const fresh = await this.dependencies.discover(this.cwd);
					const definition = fresh.agents.find(candidate => agentIdentity(candidate) === identity);
					if (!definition) return undefined;
					const currentAgent: DashboardAgent = {
						...definition,
						disabled: ((this.#settings.get("task.disabledAgents") as string[]) ?? []).includes(definition.name),
						overrideModel: this.#settings.get("task.agentModelOverrides")[definition.name],
					};
					return { review: this.#agentReview(currentAgent, "model", proposed), target: currentAgent };
				},
				execute: async target => {
					const currentAgent = target as DashboardAgent;
					const before = { ...this.#settings.get("task.agentModelOverrides") };
					const after = { ...before };
					if (proposed) after[currentAgent.name] = proposed;
					else delete after[currentAgent.name];
					await this.#persistSetting("task.agentModelOverrides", before, after);
				},
			},
			outcome => this.#finishReview(outcome, agent.name),
			() => this.onRequestRender?.(),
			this.terminalHeight,
		);
	}

	#finishReview(outcome: ReviewedActionOutcome, name: string): void {
		this.#review = null;
		if (outcome === "succeeded") {
			this.#notice = `Saved agent settings for ${name}.`;
			this.#noticeTone = "success";
			void this.#reload("mutation");
		} else if (outcome === "interrupted") {
			this.#notice = `Agent change for ${name} was interrupted.`;
			this.#noticeTone = "warning";
		}
		this.onRequestRender?.();
	}

	#beginCreate(scope: AgentScope): void {
		this.#createScope = scope;
		this.#createError = "";
		this.#editor = new SettingsTextEditor(
			`Create ${scope} agent`,
			"Describe the agent. Generation is a preview; the resulting file is saved only after a separate review.",
			this.#createDescription,
			value => {
				this.#createDescription = value.trim();
				if (!this.#createDescription) throw new Error("Description is required.");
				this.#editor = null;
				void this.#generate();
			},
			() => {
				this.#editor = null;
				this.#createScope = null;
				this.onRequestRender?.();
			},
		);
	}

	async #generate(): Promise<void> {
		if (this.#createGenerating || !this.#createScope) return;
		this.#createGenerating = true;
		this.#createError = "";
		this.onRequestRender?.();
		try {
			const spec = this.dependencies.generate
				? await this.dependencies.generate(this.#createDescription)
				: await this.#runCreationArchitect(this.#createDescription);
			this.#openCreateReview(spec, this.#createScope);
		} catch (error) {
			this.#createError = error instanceof Error ? error.message : String(error);
			this.#editor = new SettingsTextEditor(
				`Create ${this.#createScope} agent`,
				`Generation failed: ${this.#createError} · Edit the description and retry.`,
				this.#createDescription,
				value => {
					this.#createDescription = value.trim();
					if (!this.#createDescription) throw new Error("Description is required.");
					this.#editor = null;
					void this.#generate();
				},
				() => {
					this.#editor = null;
					this.#createScope = null;
					this.onRequestRender?.();
				},
			);
		} finally {
			this.#createGenerating = false;
			this.onRequestRender?.();
		}
	}

	async #runCreationArchitect(description: string): Promise<GeneratedAgentSpec> {
		const registry = this.modelContext.modelRegistry;
		if (!registry) throw new Error("Model registry unavailable in current session.");
		await registry.refresh();
		const patterns = resolveConfiguredModelPatterns(
			this.modelContext.activeModelPattern ??
				this.modelContext.defaultModelPattern ??
				this.#settings.getModelRole("default"),
			this.#settings,
		);
		const selected = resolveModelOverride(patterns, registry, this.#settings).model ?? registry.getAvailable()[0];
		if (!selected) throw new Error("No available model can generate an agent specification.");
		const { session } = await createAgentSession({
			cwd: this.cwd,
			authStorage: registry.authStorage,
			modelRegistry: registry,
			settings: this.#settings,
			model: selected,
			systemPrompt: prompt.render(agentCreationArchitectPrompt, { TASK_TOOL_NAME: "task" }),
			hasUI: false,
			enableLsp: false,
			enableMCP: false,
			disableExtensionDiscovery: true,
			toolNames: ["__none__"],
			customTools: [],
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
		});
		try {
			await session.prompt(prompt.render(agentCreationUserPrompt, { request: description }), {
				expandPromptTemplates: false,
			});
			const raw = extractAssistantText(session.state.messages);
			if (!raw) throw new Error("No response returned by the agent creation architect.");
			return parseGeneratedAgentSpec(raw);
		} finally {
			await session.dispose();
		}
	}

	#creationTarget(spec: GeneratedAgentSpec, scope: AgentScope): AgentCreationTarget {
		const directory = this.dependencies.resolveDirectory(this.cwd, scope);
		if (!directory) throw new Error(`Cannot resolve ${scope} agents directory.`);
		return { directory, file: path.join(directory, `${spec.identifier}.md`), content: agentFileContent(spec) };
	}

	#createReview(spec: GeneratedAgentSpec, scope: AgentScope, target: { file: string; content: string }): ActionReview {
		return {
			identity: `agent-file:${target.file}`,
			scope: `${scope} agent definition`,
			revision: revision({ spec, scope, target }),
			changes: [
				{ field: "File", before: "Absent", after: target.file },
				{ field: "Identifier", before: "Absent", after: spec.identifier },
				{ field: "When to use", before: "Absent", after: spec.whenToUse },
				{ field: "System prompt", before: "Absent", after: spec.systemPrompt },
			],
			consequence:
				"Creates one new Markdown agent definition with private file permissions. It never overwrites an existing file; discovery refresh follows only after the write succeeds.",
		};
	}

	#openCreateReview(spec: GeneratedAgentSpec, scope: AgentScope): void {
		let target: AgentCreationTarget;
		try {
			target = this.#creationTarget(spec, scope);
		} catch (error) {
			this.#createError = error instanceof Error ? error.message : String(error);
			return;
		}
		const review = this.#createReview(spec, scope, target);
		this.#review = new ReviewedActionDialog(
			"agent file creation",
			{
				review,
				resolve: async () => {
					const current = this.#creationTarget(spec, scope);
					try {
						await this.dependencies.stat(current.file);
						return undefined;
					} catch (error) {
						if (!isEnoent(error)) throw error;
					}
					return { review: this.#createReview(spec, scope, current), target: current };
				},
				execute: async current => {
					const exact = current as typeof target;
					await this.dependencies.mkdir(exact.directory);
					await this.dependencies.writeExclusive(exact.file, exact.content);
				},
			},
			outcome => {
				this.#review = null;
				if (outcome === "succeeded") {
					this.#notice = `Created ${spec.identifier} in ${scope} scope.`;
					this.#noticeTone = "success";
					this.#createScope = null;
					this.#createDescription = "";
					void this.#reload("mutation");
				}
				this.onRequestRender?.();
			},
			() => this.onRequestRender?.(),
			this.terminalHeight,
		);
	}

	override render(width: number): string[] {
		if (this.#review) return this.#review.render(width);
		if (this.#editor) return this.#editor.render(width);
		const inner = selectorFrameContentWidth(width);
		const height = this.terminalHeight();
		if (this.#createScopeChoice) {
			const choices = ["Cancel", "Create project agent", "Create user agent"];
			this.#lastLines = selectorFrame(
				width,
				height,
				"Choose agent scope",
				"Select where the generated definition would be saved",
				[],
				choices.map((label, index) => selectorRow([label], [inner - 2], index === this.#createScopeChoiceIndex)),
				["Cancel is selected initially. No generation or file write has started."],
				["Esc: back"],
				{ selectedBodyIndex: this.#createScopeChoiceIndex },
			);
			this.#clickRows.clear();
			for (let line = 0; line < this.#lastLines.length; line++) {
				const plain = Bun.stripANSI(this.#lastLines[line] ?? "");
				const index = choices.findIndex(choice => plain.includes(choice));
				if (index >= 0) this.#clickRows.set(line, `scope:${index}`);
			}
			return this.#lastLines;
		}
		if (this.#createGenerating)
			return selectorFrame(
				width,
				height,
				"Generating agent specification",
				`${this.#createScope} scope · No file has been written`,
				[],
				["Generation in progress…"],
				[this.#createDescription],
				["This operation cannot be interrupted; waiting for its result."],
			);

		const detailsAgent = this.#detailsAgent();
		if (this.#detailsIdentity && detailsAgent) {
			const defaultPatterns = this.#defaultPatterns(detailsAgent);
			const effectivePatterns = this.#effectivePatterns(detailsAgent);
			const resolvedDefault = this.#resolve(defaultPatterns);
			const resolvedEffective = this.#resolve(effectivePatterns);
			const actions = [
				`${detailsAgent.disabled ? "Enable" : "Disable"} agent`,
				"Edit model override",
				"Create project agent",
				"Create user agent",
			];
			const details = [
				`Identifier: ${detailsAgent.name}`,
				`Source: ${SOURCE_LABEL[detailsAgent.source]}`,
				`Path: ${detailsAgent.filePath ?? "Bundled definition"}`,
				`Saved enabled state: ${detailsAgent.disabled ? "Disabled" : "Enabled"}`,
				`Default pattern: ${defaultPatterns.join(", ") || "Session model"}`,
				`Default resolves: ${resolvedDefault?.resolved ?? "Unresolved"}`,
				`Saved override: ${detailsAgent.overrideModel ?? "(none)"}`,
				`Effective pattern: ${effectivePatterns.join(", ") || "Session model"}`,
				`Effective resolves: ${resolvedEffective?.resolved ?? "Unresolved"}${resolvedEffective?.explicitThinkingLevel && resolvedEffective.thinkingLevel ? ` (${resolvedEffective.thinkingLevel})` : ""}`,
				detailsAgent.description,
			];
			const wrapped = details.flatMap(line => wrapTextWithAnsi(replaceTabs(line), inner));
			this.#detailCapacity = Math.max(1, height - 11 - actions.length);
			this.#detailLength = wrapped.length;
			this.#detailOffset = Math.min(this.#detailOffset, Math.max(0, wrapped.length - this.#detailCapacity));
			this.#lastLines = selectorFrame(
				width,
				height,
				"Agent details",
				detailsAgent.name,
				[],
				actions.map((label, index) => selectorRow([label], [inner - 2], index === this.#actionIndex)),
				wrapped.slice(this.#detailOffset, this.#detailOffset + this.#detailCapacity),
				[
					...(this.#notice ? [theme.fg(this.#noticeTone, this.#notice)] : []),
					...(wrapped.length > this.#detailCapacity ? ["PgUp/PgDn: details"] : []),
					"Esc: back",
				],
				{ selectedBodyIndex: this.#actionIndex },
			);
			this.#mapRows(actions.map((_, index) => `action:${index}`));
			return this.#lastLines;
		}

		const filtered = this.#filtered();
		const selected = this.#selected();
		this.#remember(selected);
		const createMatches =
			!this.#search.getValue().trim() || "create new agent".includes(this.#search.getValue().trim().toLowerCase());
		const rows = [
			...(createMatches
				? [selectorRow(["Create new agent", "Named action"], [Math.max(1, inner - 18), 14], !selected)]
				: []),
			...filtered.map(agent =>
				selectorRow(
					[
						agent.name,
						agent.disabled ? "Disabled" : "Enabled",
						SOURCE_LABEL[agent.source],
						agent.overrideModel ?? "Default model",
					],
					[Math.max(1, Math.floor(inner * 0.34)), 10, 9, Math.max(1, inner - Math.floor(inner * 0.34) - 25)],
					agent === selected,
				),
			),
		];
		const tabLine = this.#tabs
			.map(
				tab =>
					`${tab.id === this.#activeTab ? "[" : ""}${tab.label} (${tab.count})${tab.id === this.#activeTab ? "]" : ""}`,
			)
			.join("  ");
		this.#lastLines = selectorFrame(
			width,
			height,
			"Agent control center",
			"Inspect effective agent identity before changing saved user defaults or creating files",
			[tabLine, ...this.#search.render(Math.max(1, inner - 8)).map(line => `Search: ${line}`)],
			rows.length
				? rows
				: [this.#all.length ? `No agents match “${this.#search.getValue()}”.` : "No agents are available."],
			[
				selected ? `${selected.name} · ${selected.source} · ${selected.filePath ?? "bundled"}` : "",
				this.#notice ? theme.fg(this.#noticeTone, this.#notice) : "",
				this.#createError ? theme.fg("error", this.#createError) : "",
				this.#loading ? theme.fg("muted", "Refreshing while cached results remain available…") : "",
			],
			["Tab/Shift+Tab: source", "Ctrl+R: refresh", "Esc: back"],
			{
				selectedBodyIndex:
					createMatches && !selected ? 0 : Math.max(0, (createMatches ? 1 : 0) + filtered.indexOf(selected!)),
				overflowHint: "PgUp/PgDn: more agents",
			},
		);
		this.#mapRows([...(createMatches ? ["create"] : []), ...filtered.map(agent => agentIdentity(agent))]);
		return this.#lastLines;
	}

	#mapRows(_keys: string[]): void {
		this.#clickRows.clear();
		for (let line = 0; line < this.#lastLines.length; line++) {
			const plain = Bun.stripANSI(this.#lastLines[line] ?? "");
			if (plain.includes("Create new agent")) this.#clickRows.set(line, "create");
			else if (this.#detailsIdentity) {
				const action = [
					"Enable agent",
					"Disable agent",
					"Edit model override",
					"Create project agent",
					"Create user agent",
				].findIndex(label => plain.includes(label));
				if (action >= 0) {
					const actual = plain.includes("Edit model")
						? 1
						: plain.includes("project")
							? 2
							: plain.includes("user")
								? 3
								: 0;
					this.#clickRows.set(line, `action:${actual}`);
				}
			} else {
				for (const agent of this.#filtered())
					if (plain.includes(agent.name) && plain.includes(SOURCE_LABEL[agent.source])) {
						this.#clickRows.set(line, agentIdentity(agent));
						break;
					}
			}
		}
	}

	#openCreateScopeChoice(): void {
		this.#detailsIdentity = null;
		this.#createScopeChoice = true;
		this.#createScopeChoiceIndex = 0;
		this.onRequestRender?.();
	}

	handleInput(data: string): void {
		if (this.#review) {
			this.#review.handleInput(data);
			return;
		}
		if (this.#createGenerating || data === "\x03") return;
		if (this.#editor) {
			this.#editor.handleInput(data);
			return;
		}
		if (this.#createScopeChoice) {
			if (matchesSelectorKey(data, "cancel")) this.#createScopeChoice = false;
			else if (matchesSelectorKey(data, "up") || matchesSelectorKey(data, "down")) {
				const delta = matchesSelectorKey(data, "up") ? -1 : 1;
				this.#createScopeChoiceIndex = (this.#createScopeChoiceIndex + delta + 3) % 3;
			} else if (matchesSelectorKey(data, "confirm")) {
				const index = this.#createScopeChoiceIndex;
				this.#createScopeChoice = false;
				if (index > 0) this.#beginCreate(index === 1 ? "project" : "user");
			}
			this.onRequestRender?.();
			return;
		}
		const details = this.#detailsAgent();
		if (this.#detailsIdentity && details) {
			if (matchesSelectorKey(data, "cancel")) {
				this.#detailsIdentity = null;
				this.#actionIndex = 0;
				this.#detailOffset = 0;
			} else if (matchesSelectorKey(data, "up") || matchesSelectorKey(data, "down")) {
				const delta = matchesSelectorKey(data, "up") ? -1 : 1;
				this.#actionIndex = (this.#actionIndex + delta + 4) % 4;
			} else if (matchesSelectorKey(data, "pageDown"))
				this.#detailOffset = Math.min(
					Math.max(0, this.#detailLength - this.#detailCapacity),
					this.#detailOffset + this.#detailCapacity,
				);
			else if (matchesSelectorKey(data, "pageUp"))
				this.#detailOffset = Math.max(0, this.#detailOffset - this.#detailCapacity);
			else if (matchesSelectorKey(data, "confirm")) {
				if (this.#actionIndex === 0) this.#openEnabledReview(details);
				else if (this.#actionIndex === 1) this.#beginModelEdit(details);
				else this.#beginCreate(this.#actionIndex === 2 ? "project" : "user");
			}
			this.onRequestRender?.();
			return;
		}
		if (data === "\x12") {
			void this.#reload("manual");
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
				this.#queries.set(this.#activeTab, "");
				this.#remember(this.#selected());
			} else this.onClose?.();
		} else if (matchesSelectorKey(data, "up") || matchesSelectorKey(data, "down")) {
			const items = this.#filtered();
			const keys = [CREATE_AGENT_IDENTITY, ...items.map(agent => agentIdentity(agent))];
			if (keys.length) {
				const current =
					this.#selections.get(this.#activeTab) ?? (items[0] ? agentIdentity(items[0]) : CREATE_AGENT_IDENTITY);
				const index = Math.max(0, keys.indexOf(current));
				const delta = matchesSelectorKey(data, "up") ? -1 : 1;
				this.#selections.set(this.#activeTab, keys[(index + delta + keys.length) % keys.length]!);
			}
		} else if (matchesSelectorKey(data, "confirm")) {
			const selected = this.#selected();
			if (selected) {
				this.#detailsIdentity = agentIdentity(selected);
				this.#actionIndex = 0;
			} else this.#openCreateScopeChoice();
		} else {
			const before = this.#search.getValue();
			this.#search.handleInput(data);
			if (before !== this.#search.getValue()) {
				this.#queries.set(this.#activeTab, this.#search.getValue());
				this.#remember(this.#selected());
			}
		}
		this.onRequestRender?.();
	}

	routeMouse(event: SgrMouseEvent, line: number): void {
		if (this.#review || this.#editor || this.#createGenerating || event.release) return;
		if (event.wheel !== null) {
			this.handleInput(event.wheel > 0 ? "\x1b[B" : "\x1b[A");
			return;
		}
		if (!event.leftClick) return;
		const key = this.#clickRows.get(line);
		if (!key) return;
		if (key.startsWith("scope:")) {
			this.#createScopeChoiceIndex = Number(key.slice(6));
			this.handleInput("\r");
		} else if (key === "create") this.#openCreateScopeChoice();
		else if (key.startsWith("action:")) {
			this.#actionIndex = Number(key.slice(7));
			this.handleInput("\r");
		} else {
			const already = this.#selections.get(this.#activeTab) === key;
			this.#selections.set(this.#activeTab, key);
			if (already) this.#detailsIdentity = key;
			this.onRequestRender?.();
		}
	}
}
