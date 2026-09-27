/**
 * Codex Discovery Provider
 *
 * Loads configuration from OpenAI Codex format:
 * - System Instructions: AGENTS.md (user-level only at ~/.codex/AGENTS.md)
 *
 * User directory: ~/.codex
 */
import * as path from "node:path";
import { logger, parseFrontmatter } from "@f5-sales-demo/pi-utils";
import { registerProvider } from "../capability";
import type { ContextFile } from "../capability/context-file";
import { contextFileCapability } from "../capability/context-file";
import { type ExtensionModule, extensionModuleCapability } from "../capability/extension-module";
import { readFile } from "../capability/fs";
import type { Hook } from "../capability/hook";
import { hookCapability } from "../capability/hook";
import type { Prompt } from "../capability/prompt";
import { promptCapability } from "../capability/prompt";
import type { Settings } from "../capability/settings";
import { settingsCapability } from "../capability/settings";
import type { Skill } from "../capability/skill";
import { skillCapability } from "../capability/skill";
import type { SlashCommand } from "../capability/slash-command";
import { slashCommandCapability } from "../capability/slash-command";
import type { CustomTool } from "../capability/tool";
import { toolCapability } from "../capability/tool";
import type { LoadContext, LoadResult, SourceMeta } from "../capability/types";

import {
	createSourceMeta,
	discoverExtensionModulePaths,
	getExtensionNameFromPath,
	loadFilesFromDir,
	SOURCE_PATHS,
	scanSkillsFromDir,
} from "./helpers";

const PROVIDER_ID = "codex";
const SOURCE_LABEL = "OpenAI Codex";
const PRIORITY = 70;

function getProjectCodexDir(ctx: LoadContext): string {
	return path.join(ctx.cwd, ".codex");
}

async function loadTomlConfig(_ctx: LoadContext, configPath: string): Promise<Record<string, unknown> | null> {
	const content = await readFile(configPath);
	if (!content) return null;
	try {
		return Bun.TOML.parse(content) as Record<string, unknown>;
	} catch (error) {
		logger.warn("Failed to parse TOML config", { path: configPath, error: String(error) });
		return null;
	}
}

// =============================================================================
// Context Files (AGENTS.md)
// =============================================================================

async function loadContextFiles(ctx: LoadContext): Promise<LoadResult<ContextFile>> {
	const items: ContextFile[] = [];
	const warnings: string[] = [];

	// User level only: ~/.codex/AGENTS.md
	const agentsMd = path.join(ctx.home, SOURCE_PATHS.codex.userBase, "AGENTS.md");
	const agentsContent = await readFile(agentsMd, ctx.signal);
	if (agentsContent) {
		items.push({
			path: agentsMd,
			content: agentsContent,
			level: "user",
			_source: createSourceMeta(PROVIDER_ID, agentsMd, "user"),
		});
	}

	return { items, warnings };
}

// =============================================================================
// Skills (skills/)
// =============================================================================

async function loadSkills(ctx: LoadContext): Promise<LoadResult<Skill>> {
	const userSkillsDir = path.join(ctx.home, SOURCE_PATHS.codex.userBase, "skills");
	const codexDir = getProjectCodexDir(ctx);
	const projectSkillsDir = path.join(codexDir, "skills");

	const results = await Promise.all([
		scanSkillsFromDir(ctx, {
			dir: userSkillsDir,
			providerId: PROVIDER_ID,
			level: "user",
			signal: ctx.signal,
		}),
		scanSkillsFromDir(ctx, {
			dir: projectSkillsDir,
			providerId: PROVIDER_ID,
			level: "project",
			signal: ctx.signal,
		}),
	]);

	const items = results.flatMap(r => r.items);
	const warnings = results.flatMap(r => r.warnings || []);

	return { items, warnings };
}

// =============================================================================
// Extension Modules (extensions/)
// =============================================================================

async function loadExtensionModules(ctx: LoadContext): Promise<LoadResult<ExtensionModule>> {
	const warnings: string[] = [];

	const userExtensionsDir = path.join(ctx.home, SOURCE_PATHS.codex.userBase, "extensions");
	const codexDir = getProjectCodexDir(ctx);
	const projectExtensionsDir = path.join(codexDir, "extensions");

	const [userPaths, projectPaths] = await Promise.all([
		discoverExtensionModulePaths(ctx, userExtensionsDir),
		discoverExtensionModulePaths(ctx, projectExtensionsDir),
	]);

	const items: ExtensionModule[] = [
		...userPaths.map(extPath => ({
			name: getExtensionNameFromPath(extPath),
			path: extPath,
			level: "user" as const,
			_source: createSourceMeta(PROVIDER_ID, extPath, "user"),
		})),
		...projectPaths.map(extPath => ({
			name: getExtensionNameFromPath(extPath),
			path: extPath,
			level: "project" as const,
			_source: createSourceMeta(PROVIDER_ID, extPath, "project"),
		})),
	];

	return { items, warnings };
}

// =============================================================================
// Slash Commands (commands/)
// =============================================================================

async function loadSlashCommands(ctx: LoadContext): Promise<LoadResult<SlashCommand>> {
	const userCommandsDir = path.join(ctx.home, SOURCE_PATHS.codex.userBase, "commands");
	const codexDir = getProjectCodexDir(ctx);
	const projectCommandsDir = path.join(codexDir, "commands");

	const transformCommand =
		(level: "user" | "project") => (name: string, content: string, path: string, source: SourceMeta) => {
			const { frontmatter, body } = parseFrontmatter(content, { source: path });
			const commandName = frontmatter.name || name.replace(/\.md$/, "");
			return {
				name: String(commandName),
				path,
				content: body,
				level,
				_source: source,
			};
		};

	const results = await Promise.all([
		loadFilesFromDir(ctx, userCommandsDir, PROVIDER_ID, "user", {
			extensions: ["md"],
			transform: transformCommand("user"),
		}),
		loadFilesFromDir(ctx, projectCommandsDir, PROVIDER_ID, "project", {
			extensions: ["md"],
			transform: transformCommand("project"),
		}),
	]);

	const items = results.flatMap(r => r.items);
	const warnings = results.flatMap(r => r.warnings || []);

	return { items, warnings };
}

// =============================================================================
// Prompts (prompts/*.md)
// =============================================================================

async function loadPrompts(ctx: LoadContext): Promise<LoadResult<Prompt>> {
	const userPromptsDir = path.join(ctx.home, SOURCE_PATHS.codex.userBase, "prompts");
	const codexDir = getProjectCodexDir(ctx);
	const projectPromptsDir = path.join(codexDir, "prompts");

	const transformPrompt = (name: string, content: string, path: string, source: SourceMeta) => {
		const { frontmatter, body } = parseFrontmatter(content, { source: path });
		const promptName = frontmatter.name || name.replace(/\.md$/, "");
		return {
			name: String(promptName),
			path,
			content: body,
			description: frontmatter.description ? String(frontmatter.description) : undefined,
			_source: source,
		};
	};

	const results = await Promise.all([
		loadFilesFromDir(ctx, userPromptsDir, PROVIDER_ID, "user", {
			extensions: ["md"],
			transform: transformPrompt,
		}),
		loadFilesFromDir(ctx, projectPromptsDir, PROVIDER_ID, "project", {
			extensions: ["md"],
			transform: transformPrompt,
		}),
	]);

	const items = results.flatMap(r => r.items);
	const warnings = results.flatMap(r => r.warnings || []);

	return { items, warnings };
}

// =============================================================================
// Hooks (hooks/)
// =============================================================================

async function loadHooks(ctx: LoadContext): Promise<LoadResult<Hook>> {
	const userHooksDir = path.join(ctx.home, SOURCE_PATHS.codex.userBase, "hooks");
	const codexDir = getProjectCodexDir(ctx);
	const projectHooksDir = path.join(codexDir, "hooks");

	const transformHook =
		(level: "user" | "project") => (name: string, _content: string, path: string, source: SourceMeta) => {
			const baseName = name.replace(/\.(ts|js)$/, "");
			const match = baseName.match(/^(pre|post)-(.+)$/);
			const hookType = (match?.[1] as "pre" | "post") || "pre";
			const toolName = match?.[2] || baseName;
			return {
				name,
				path,
				type: hookType,
				tool: toolName,
				level,
				_source: source,
			};
		};

	const results = await Promise.all([
		loadFilesFromDir(ctx, userHooksDir, PROVIDER_ID, "user", {
			extensions: ["ts", "js"],
			transform: transformHook("user"),
		}),
		loadFilesFromDir(ctx, projectHooksDir, PROVIDER_ID, "project", {
			extensions: ["ts", "js"],
			transform: transformHook("project"),
		}),
	]);

	const items = results.flatMap(r => r.items);
	const warnings = results.flatMap(r => r.warnings || []);

	return { items, warnings };
}

// =============================================================================
// Tools (tools/)
// =============================================================================

async function loadTools(ctx: LoadContext): Promise<LoadResult<CustomTool>> {
	const userToolsDir = path.join(ctx.home, SOURCE_PATHS.codex.userBase, "tools");
	const codexDir = getProjectCodexDir(ctx);
	const projectToolsDir = path.join(codexDir, "tools");

	const transformTool =
		(level: "user" | "project") => (name: string, _content: string, path: string, source: SourceMeta) => {
			const toolName = name.replace(/\.(ts|js)$/, "");
			return {
				name: toolName,
				path,
				level,
				_source: source,
			} as CustomTool;
		};

	const results = await Promise.all([
		loadFilesFromDir(ctx, userToolsDir, PROVIDER_ID, "user", {
			extensions: ["ts", "js"],
			transform: transformTool("user"),
		}),
		loadFilesFromDir(ctx, projectToolsDir, PROVIDER_ID, "project", {
			extensions: ["ts", "js"],
			transform: transformTool("project"),
		}),
	]);

	const items = results.flatMap(r => r.items);
	const warnings = results.flatMap(r => r.warnings || []);

	return { items, warnings };
}

// =============================================================================
// Settings (config.toml)
// =============================================================================

async function loadSettings(ctx: LoadContext): Promise<LoadResult<Settings>> {
	const warnings: string[] = [];

	const userConfigPath = path.join(ctx.home, SOURCE_PATHS.codex.userBase, "config.toml");
	const codexDir = getProjectCodexDir(ctx);
	const projectConfigPath = path.join(codexDir, "config.toml");

	const [userConfig, projectConfig] = await Promise.all([
		loadTomlConfig(ctx, userConfigPath),
		loadTomlConfig(ctx, projectConfigPath),
	]);

	const items: Settings[] = [];
	if (userConfig) {
		items.push({
			...userConfig,
			_source: createSourceMeta(PROVIDER_ID, userConfigPath, "user"),
		} as Settings);
	}
	if (projectConfig) {
		items.push({
			...projectConfig,
			_source: createSourceMeta(PROVIDER_ID, projectConfigPath, "project"),
		} as Settings);
	}

	return { items, warnings };
}

// =============================================================================
// Provider Registration (executes on module import)
// =============================================================================

registerProvider<ContextFile>(contextFileCapability.id, {
	id: PROVIDER_ID,
	displayName: SOURCE_LABEL,
	description: "Load context files from ~/.codex/AGENTS.md (user-level only)",
	priority: PRIORITY,
	load: loadContextFiles,
});

registerProvider<Skill>(skillCapability.id, {
	id: PROVIDER_ID,
	displayName: SOURCE_LABEL,
	description: "Load skills from ~/.codex/skills and .codex/skills/",
	priority: PRIORITY,
	load: loadSkills,
});

registerProvider<ExtensionModule>(extensionModuleCapability.id, {
	id: PROVIDER_ID,
	displayName: SOURCE_LABEL,
	description: "Load extension modules from ~/.codex/extensions and .codex/extensions/",
	priority: PRIORITY,
	load: loadExtensionModules,
});

registerProvider<SlashCommand>(slashCommandCapability.id, {
	id: PROVIDER_ID,
	displayName: SOURCE_LABEL,
	description: "Load slash commands from ~/.codex/commands and .codex/commands/",
	priority: PRIORITY,
	load: loadSlashCommands,
});

registerProvider<Prompt>(promptCapability.id, {
	id: PROVIDER_ID,
	displayName: SOURCE_LABEL,
	description: "Load prompts from ~/.codex/prompts and .codex/prompts/",
	priority: PRIORITY,
	load: loadPrompts,
});

registerProvider<Hook>(hookCapability.id, {
	id: PROVIDER_ID,
	displayName: SOURCE_LABEL,
	description: "Load hooks from ~/.codex/hooks and .codex/hooks/",
	priority: PRIORITY,
	load: loadHooks,
});

registerProvider<CustomTool>(toolCapability.id, {
	id: PROVIDER_ID,
	displayName: SOURCE_LABEL,
	description: "Load custom tools from ~/.codex/tools and .codex/tools/",
	priority: PRIORITY,
	load: loadTools,
});

registerProvider<Settings>(settingsCapability.id, {
	id: PROVIDER_ID,
	displayName: SOURCE_LABEL,
	description: "Load settings from config.toml",
	priority: PRIORITY,
	load: loadSettings,
});
