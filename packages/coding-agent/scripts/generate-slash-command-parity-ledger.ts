import { resolve } from "node:path";

const BASELINE_VERSION = "v21.24.4";
const BASELINE_COMMIT = "0c6d27e4afacc42b598478d1fba532ef1eab9204";
const CURRENT_COMMIT = "e68d757fa7ebf6f6e5b36d52138e99712c565065";
const output = resolve(import.meta.dir, "../test/evidence/slash-command-parity-ledger.json");

const baselineRootFlag = process.argv.indexOf("--baseline-root");
if (baselineRootFlag === -1 || !process.argv[baselineRootFlag + 1])
	throw new Error("Usage: bun generate-slash-command-parity-ledger.ts --baseline-root <v21.24.4 worktree>");
const baselineRoot = resolve(process.argv[baselineRootFlag + 1]!);
const baselineRegistry = resolve(baselineRoot, "packages/coding-agent/src/slash-commands/builtin-registry.ts");
const preFixRootFlag = process.argv.indexOf("--pre-fix-root");
if (preFixRootFlag === -1 || !process.argv[preFixRootFlag + 1])
	throw new Error(
		"Usage: bun generate-slash-command-parity-ledger.ts --baseline-root <v21.24.4 worktree> --pre-fix-root <e68d757 worktree>",
	);
const preFixRoot = resolve(process.argv[preFixRootFlag + 1]!);
const preFixRegistry = resolve(preFixRoot, "packages/coding-agent/src/slash-commands/builtin-registry.ts");

interface CommandDefinition {
	name: string;
	inlineHint?: string;
	subcommands?: ReadonlyArray<{ name: string; usage?: string }>;
}

interface CommandSnapshot {
	name: string;
	syntax: string;
	aliases: string[];
	acceptsArguments: boolean;
	subcommands: Array<{ name: string; syntax: string }>;
}

function topLevelCommandBlocks(source: string): Map<string, string> {
	const registry = source.slice(source.indexOf("const BUILTIN_SLASH_COMMAND_REGISTRY"));
	const matches = [...registry.matchAll(/^\t\{\n\t\tname: "([^"]+)"/gm)];
	return new Map(
		matches.map((match, index) => [
			match[1]!,
			registry.slice(match.index, matches[index + 1]?.index ?? registry.indexOf("\n];", match.index)),
		]),
	);
}

function aliasesFromBlock(block: string): string[] {
	const value = /^\t\taliases: \[([^\]]*)\]/m.exec(block)?.[1];
	return value ? [...value.matchAll(/"([^"]+)"/g)].map(match => match[1]!) : [];
}

function localeValue(locale: Record<string, unknown>, key: string): string | undefined {
	let value: unknown = locale;
	for (const segment of key.split(".")) {
		if (!value || typeof value !== "object") return undefined;
		value = (value as Record<string, unknown>)[segment];
	}
	return typeof value === "string" ? value : undefined;
}

function sourceString(expression: string | undefined, locale: Record<string, unknown>): string | undefined {
	if (!expression) return undefined;
	const quoted = /^"([^"]*)"$/.exec(expression.trim())?.[1];
	if (quoted !== undefined) return quoted;
	const key = /t\("([^"]+)"\)/.exec(expression)?.[1];
	return key ? localeValue(locale, key) : undefined;
}

function sourceDefinitions(source: string, locale: Record<string, unknown>): CommandDefinition[] {
	const blocks = topLevelCommandBlocks(source);
	const subcommandConstants = new Map<string, Array<{ name: string; usage?: string }>>();
	for (const match of source.matchAll(/const\s+(\w+_SUBCOMMANDS):\s*SubcommandDef\[\]\s*=\s*\[([\s\S]*?)\n\];/g)) {
		const definitions = [...match[2]!.matchAll(/\{\s*name:\s*"([^"]+)"[^}]*?(?:usage:\s*([^,}\n]+))?[^}]*\}/g)].map(
			subcommand => ({
				name: subcommand[1]!,
				usage: sourceString(subcommand[2], locale),
			}),
		);
		subcommandConstants.set(match[1]!, definitions);
	}
	return [...blocks].map(([name, block]) => {
		const inlineHint = sourceString(/^\t\tinlineHint:\s*([^,\n]+),/m.exec(block)?.[1], locale);
		const directSubcommands = /^\t\tsubcommands:\s*\[([\s\S]*?)\],\n\t\t(?:allowArgs|handle):/m.exec(block)?.[1];
		const referencedSubcommands = /^\t\tsubcommands:\s*(\w+_SUBCOMMANDS),/m.exec(block)?.[1];
		const subcommands = directSubcommands
			? [...directSubcommands.matchAll(/\{\s*name:\s*"([^"]+)"[^}]*?(?:usage:\s*([^,}\n]+))?[^}]*\}/g)].map(
					subcommand => ({ name: subcommand[1]!, usage: sourceString(subcommand[2], locale) }),
				)
			: referencedSubcommands
				? (subcommandConstants.get(referencedSubcommands) ?? [])
				: [];
		return { name, inlineHint, subcommands };
	});
}

function snapshots(definitions: ReadonlyArray<CommandDefinition>, source: string): CommandSnapshot[] {
	const blocks = topLevelCommandBlocks(source);
	return definitions.map(definition => {
		const block = blocks.get(definition.name);
		if (!block) throw new Error(`Could not locate source block for /${definition.name}`);
		const aliases = aliasesFromBlock(block);
		const acceptsArguments = /^\t\tallowArgs: true,/m.test(block);
		return {
			name: definition.name,
			syntax: `/${definition.name}${definition.inlineHint ? ` ${definition.inlineHint}` : ""}`,
			aliases,
			acceptsArguments,
			subcommands: (definition.subcommands ?? []).map(subcommand => ({
				name: subcommand.name,
				syntax: `/${definition.name} ${subcommand.name}${subcommand.usage ? ` ${subcommand.usage}` : ""}`,
			})),
		};
	});
}

const baselineSource = await Bun.file(baselineRegistry).text();
const baselineLocale = (await Bun.file(
	resolve(baselineRoot, "packages/coding-agent/src/locales/en.json"),
).json()) as Record<string, unknown>;
const preFixSource = await Bun.file(preFixRegistry).text();
const preFixLocale = (await Bun.file(
	resolve(preFixRoot, "packages/coding-agent/src/locales/en.json"),
).json()) as Record<string, unknown>;
const baseline = snapshots(sourceDefinitions(baselineSource, baselineLocale), baselineSource);
const current = snapshots(sourceDefinitions(preFixSource, preFixLocale), preFixSource);
const baselineByName = new Map(baseline.map(command => [command.name, command]));
const currentByName = new Map(current.map(command => [command.name, command]));
const names = [...new Set([...baselineByName.keys(), ...currentByName.keys()])].sort();

function inventoryClassification(before: CommandSnapshot | undefined, after: CommandSnapshot | undefined) {
	if (!before) return "additive";
	if (!after) return "removed-unapproved";
	return JSON.stringify(before) === JSON.stringify(after) ? "unchanged" : "changed-needs-behavior-review";
}

function childSurfaces(command: string, snapshot: CommandSnapshot | undefined): Set<string> {
	return new Set([
		...(snapshot?.aliases ?? []).map(alias => `/${alias}`),
		...(snapshot?.subcommands ?? []).map(subcommand => `/${command} ${subcommand.name}`),
	]);
}

function childClassification(surface: string, before: Set<string>, after: Set<string>): string {
	if (!before.has(surface)) return "additive";
	if (!after.has(surface)) return "removed-unapproved";
	return "pending-differential-uat";
}

const entries = names.map(command => {
	const before = baselineByName.get(command);
	const after = currentByName.get(command);
	const beforeSurfaces = childSurfaces(command, before);
	const afterSurfaces = childSurfaces(command, after);
	const surfaces = [...new Set([...beforeSurfaces, ...afterSurfaces])];
	const settings = command === "settings";
	const manifest = command === "manifest";
	const force = command === "force";
	const fast = command === "fast";
	const route = command === "route";
	const plan = command === "plan";
	const compact = command === "compact";
	const reloadPlugins = command === "reload-plugins";
	const newSession = command === "new";
	const fork = command === "fork";
	const rename = command === "rename";
	const move = command === "move";
	const hotkeys = command === "hotkeys";
	const readOnlyReport = ["hotkeys", "jobs", "tools", "usage"].includes(command);
	const changelog = command === "changelog";
	const debug = command === "debug";
	const background = command === "background";
	const btw = command === "btw";
	const reviewedExit = command === "exit" || command === "quit";
	const memory = command === "memory";
	const media = command === "media";
	const providerCredentialAction = ["login", "logout"].includes(command);
	const model = command === "model";
	const browser = command === "browser";
	const chrome = command === "chrome";
	const clipboardAction = ["copy", "dump"].includes(command);
	const open = command === "open";
	const session = command === "session";
	const branch = command === "branch";
	const tree = command === "tree";
	const resume = command === "resume";
	const exportSession = command === "export";
	const share = command === "share";
	const handoff = command === "handoff";
	const resourceMutation = ["apply", "create", "delete"].includes(command);
	const resourceRead = ["describe", "diff", "get"].includes(command);
	const agents = command === "agents";
	const extensions = command === "extensions";
	const plugin = command === "plugin";
	const context = command === "context";
	const mcp = command === "mcp";
	const ssh = command === "ssh";
	return {
		command: `/${command}`,
		baseline: before ?? null,
		current: after ?? null,
		inventoryClassification: inventoryClassification(before, after),
		behaviorClassification:
			settings || manifest
				? "confirmed-regression"
				: force ||
						fast ||
						route ||
						plan ||
						compact ||
						newSession ||
						fork ||
						rename ||
						move ||
						exportSession ||
						share ||
						handoff ||
						resourceMutation ||
						agents ||
						extensions ||
						plugin ||
						context ||
						mcp ||
						ssh
					? "intentional-safety-addition"
					: reloadPlugins || resourceRead
						? "intentional-redesign"
						: branch
							? "intentional-redesign"
							: readOnlyReport
								? "intentional-redesign"
								: changelog
									? "intentional-redesign"
									: debug
										? "intentional-redesign"
										: background ||
												btw ||
												reviewedExit ||
												memory ||
												providerCredentialAction ||
												model ||
												browser ||
												chrome ||
												clipboardAction ||
												open ||
												session ||
												tree ||
												resume
											? "intentional-safety-addition"
											: media
												? "additive"
												: "pending-differential-uat",
		surfaceClassifications: Object.fromEntries(
			surfaces.map(surface => [
				surface,
				fast || route
					? "intentional-safety-addition"
					: changelog
						? "intentional-redesign"
						: background
							? "intentional-safety-addition"
							: memory
								? surface === "/memory view"
									? "intentional-redesign"
									: "intentional-safety-addition"
								: providerCredentialAction || model
									? "intentional-safety-addition"
									: browser
										? surface === "/browser status"
											? "additive"
											: "intentional-safety-addition"
										: chrome
											? surface === "/chrome status"
												? "intentional-redesign"
												: "intentional-safety-addition"
											: clipboardAction
												? "intentional-safety-addition"
												: session
													? surface === "/session info"
														? "intentional-redesign"
														: "intentional-safety-addition"
													: media
														? "unchanged"
														: plugin
															? [
																	"/marketplace",
																	"/plugins",
																	"/plugin marketplace",
																	"/plugin discover",
																	"/plugin list",
																	"/plugin validate",
																	"/plugin help",
																].includes(surface)
																? "intentional-redesign"
																: "intentional-safety-addition"
															: agents || extensions
																? "intentional-safety-addition"
																: context
																	? !beforeSurfaces.has(surface)
																		? "additive"
																		: [
																					"/context list",
																					"/context validate",
																					"/context show",
																					"/context status",
																					"/context export",
																					"/context env",
																				].includes(surface)
																			? "intentional-redesign"
																			: "intentional-safety-addition"
																	: mcp
																		? [
																				"/mcp list",
																				"/mcp test",
																				"/mcp resources",
																				"/mcp prompts",
																				"/mcp notifications",
																				"/mcp help",
																			].includes(surface)
																			? "intentional-redesign"
																			: "intentional-safety-addition"
																		: ssh
																			? ["/ssh list", "/ssh help"].includes(surface)
																				? "intentional-redesign"
																				: "intentional-safety-addition"
																			: childClassification(surface, beforeSurfaces, afterSurfaces),
			]),
		),
		coverage: {
			visibleContent: "required",
			keyboardAndMouse: "required",
			cancelAndEscape: "required",
			outcomes: "required",
			sideEffectsAndPersistence: "required",
			responsiveVariants: "required",
		},
		baselineReceipts: settings
			? ["packages/coding-agent/test/evidence/settings-navigation-differential-v1/receipt.json"]
			: manifest
				? ["packages/coding-agent/test/evidence/resource-review-differential-v1/receipt.json"]
				: force
					? [
							"packages/coding-agent/test/evidence/slash-command-handler-differential-v1/receipt.json",
							"packages/coding-agent/test/evidence/force-differential-v1/receipt.json",
						]
					: fast
						? ["packages/coding-agent/test/evidence/fast-differential-v1/receipts.json"]
						: route
							? ["packages/coding-agent/test/evidence/route-differential-v1/receipts.json"]
							: plan
								? ["packages/coding-agent/test/evidence/plan-differential-v1/receipts.json"]
								: compact
									? [
											"packages/coding-agent/test/evidence/compact-differential-v1/receipts.json",
											"packages/coding-agent/test/evidence/compact-seeded-differential-v1/receipt.json",
										]
									: reloadPlugins
										? ["packages/coding-agent/test/evidence/reload-plugins-differential-v1/receipts.json"]
										: newSession
											? ["packages/coding-agent/test/evidence/new-differential-v1/receipts.json"]
											: fork
												? ["packages/coding-agent/test/evidence/fork-differential-v1/receipts.json"]
												: rename
													? [
															"packages/coding-agent/test/evidence/rename-differential-v1/receipts.json",
															"packages/coding-agent/test/evidence/rename-typed-differential-v1/receipts.json",
														]
													: move
														? [
																"packages/coding-agent/test/evidence/move-differential-v1/receipts.json",
																"packages/coding-agent/test/evidence/move-valid-differential-v1/receipts.json",
															]
														: readOnlyReport
															? [
																	"packages/coding-agent/test/evidence/report-runtime-keyboard-differential-v1/receipts.json",
																]
															: changelog
																? [
																		"packages/coding-agent/test/evidence/changelog-differential-v1/receipts.json",
																	]
																: debug
																	? [
																			"packages/coding-agent/test/evidence/report-runtime-keyboard-differential-v1/receipts.json",
																		]
																	: background
																		? [
																				"packages/coding-agent/test/evidence/background-keyboard-differential-v1/receipts.json",
																			]
																		: memory
																			? [
																					"packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
																				]
																			: reviewedExit
																				? [
																						"packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
																					]
																				: media
																					? [
																							"packages/coding-agent/test/evidence/media-differential-v1/receipts.json",
																						]
																					: providerCredentialAction || model
																						? [
																								"packages/coding-agent/test/evidence/foundation-login-model-differential-v1/receipts.json",
																							]
																						: browser || chrome
																							? [
																									"packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
																								]
																							: clipboardAction
																								? [
																										"packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
																									]
																								: open
																									? [
																											"packages/coding-agent/test/evidence/slash-command-open-cancel-differential-v1/receipts.json",
																										]
																									: agents ||
																											extensions ||
																											plugin ||
																											context ||
																											mcp ||
																											ssh
																										? [
																												"packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
																											]
																										: resourceMutation || resourceRead
																											? [
																													"packages/coding-agent/test/evidence/resource-review-differential-v1/receipt.json",
																												]
																											: session ||
																													branch ||
																													tree ||
																													resume ||
																													exportSession ||
																													share ||
																													handoff
																												? [
																														"packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
																													]
																												: btw
																													? [
																															"packages/coding-agent/test/evidence/slash-command-handler-differential-v1/receipt.json",
																														]
																													: [],
		currentReceipts: settings
			? ["packages/coding-agent/test/evidence/settings-navigation-differential-v1/receipt.json"]
			: manifest
				? ["packages/coding-agent/test/evidence/resource-review-differential-v1/receipt.json"]
				: force
					? [
							"packages/coding-agent/test/evidence/slash-command-handler-differential-v1/receipt.json",
							"packages/coding-agent/test/evidence/force-differential-v1/receipt.json",
						]
					: fast
						? ["packages/coding-agent/test/evidence/fast-differential-v1/receipts.json"]
						: route
							? ["packages/coding-agent/test/evidence/route-differential-v1/receipts.json"]
							: plan
								? ["packages/coding-agent/test/evidence/plan-differential-v1/receipts.json"]
								: compact
									? [
											"packages/coding-agent/test/evidence/compact-differential-v1/receipts.json",
											"packages/coding-agent/test/evidence/compact-seeded-differential-v1/receipt.json",
										]
									: reloadPlugins
										? ["packages/coding-agent/test/evidence/reload-plugins-differential-v1/receipts.json"]
										: newSession
											? ["packages/coding-agent/test/evidence/new-differential-v1/receipts.json"]
											: fork
												? ["packages/coding-agent/test/evidence/fork-differential-v1/receipts.json"]
												: rename
													? [
															"packages/coding-agent/test/evidence/rename-differential-v1/receipts.json",
															"packages/coding-agent/test/evidence/rename-typed-differential-v1/receipts.json",
														]
													: move
														? [
																"packages/coding-agent/test/evidence/move-differential-v1/receipts.json",
																"packages/coding-agent/test/evidence/move-valid-differential-v1/receipts.json",
															]
														: readOnlyReport
															? [
																	"packages/coding-agent/test/evidence/report-runtime-keyboard-differential-v1/receipts.json",
																]
															: changelog
																? [
																		"packages/coding-agent/test/evidence/changelog-differential-v1/receipts.json",
																	]
																: debug
																	? [
																			"packages/coding-agent/test/evidence/report-runtime-keyboard-differential-v1/receipts.json",
																		]
																	: background
																		? [
																				"packages/coding-agent/test/evidence/background-keyboard-differential-v1/receipts.json",
																			]
																		: memory
																			? [
																					"packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
																				]
																			: reviewedExit
																				? [
																						"packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
																					]
																				: media
																					? [
																							"packages/coding-agent/test/evidence/media-differential-v1/receipts.json",
																						]
																					: providerCredentialAction || model
																						? [
																								"packages/coding-agent/test/evidence/foundation-login-model-differential-v1/receipts.json",
																							]
																						: browser || chrome
																							? [
																									"packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
																								]
																							: clipboardAction
																								? [
																										"packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
																									]
																								: open
																									? [
																											"packages/coding-agent/test/evidence/slash-command-open-cancel-differential-v1/receipts.json",
																										]
																									: agents ||
																											extensions ||
																											plugin ||
																											context ||
																											mcp ||
																											ssh
																										? [
																												"packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
																											]
																										: resourceMutation || resourceRead
																											? [
																													"packages/coding-agent/test/evidence/resource-review-differential-v1/receipt.json",
																												]
																											: session ||
																													branch ||
																													tree ||
																													resume ||
																													exportSession ||
																													share ||
																													handoff
																												? [
																														"packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
																													]
																												: btw
																													? [
																															"packages/coding-agent/test/evidence/slash-command-handler-differential-v1/receipt.json",
																														]
																													: [],
		correctingTests: settings
			? [
					"packages/coding-agent/test/settings-draft-review.test.ts",
					"packages/coding-agent/test/settings-editors.test.ts",
				]
			: manifest
				? ["packages/coding-agent/test/slash-commands/resource-commands-review.test.ts"]
				: fast
					? ["packages/coding-agent/test/slash-commands/fast.test.ts"]
					: route
						? ["packages/coding-agent/test/slash-commands/route.test.ts"]
						: plan
							? [
									"packages/coding-agent/test/interactive-mode-plan-review.test.ts",
									"packages/coding-agent/test/plan-mode/approved-plan.test.ts",
								]
							: compact
								? [
										"packages/coding-agent/test/compaction.test.ts",
										"packages/coding-agent/test/compaction-provider-boundary.test.ts",
									]
								: reloadPlugins
									? ["packages/coding-agent/test/slash-commands/reload-plugins.test.ts"]
									: newSession
										? ["packages/coding-agent/test/modes/controllers/command-controller-new.test.ts"]
										: fork
											? ["packages/coding-agent/test/modes/controllers/command-controller-fork.test.ts"]
											: rename
												? ["packages/coding-agent/test/modes/controllers/command-controller-rename.test.ts"]
												: move
													? ["packages/coding-agent/test/session-manager/move-to.test.ts"]
													: hotkeys
														? [
																"packages/coding-agent/test/modes/controllers/command-controller-hotkeys.test.ts",
															]
														: readOnlyReport
															? [
																	"packages/coding-agent/test/modes/controllers/command-controller-reports.test.ts",
																]
															: debug
																? ["packages/coding-agent/test/debug/debug-selector-review.test.ts"]
																: background
																	? ["packages/coding-agent/test/input-controller-background.test.ts"]
																	: memory
																		? [
																				"packages/coding-agent/test/modes/controllers/command-controller-memory.test.ts",
																			]
																		: reviewedExit
																			? ["packages/coding-agent/test/slash-commands/exit.test.ts"]
																			: media
																				? [
																						"packages/coding-agent/test/media-message-component.test.ts",
																					]
																				: providerCredentialAction
																					? [
																							"packages/coding-agent/test/modes/controllers/selector-controller-oauth-login.test.ts",
																							"packages/coding-agent/test/slash-commands/login.test.ts",
																						]
																					: model
																						? [
																								"packages/coding-agent/test/modes/controllers/selector-controller-model-review.test.ts",
																							]
																						: browser || chrome
																							? [
																									"packages/coding-agent/test/slash-commands/browser.test.ts",
																								]
																							: command === "copy"
																								? [
																										"packages/coding-agent/test/slash-commands/copy.test.ts",
																										"packages/coding-agent/test/modes/controllers/selector-controller-copy.test.ts",
																									]
																								: command === "dump"
																									? [
																											"packages/coding-agent/test/modes/controllers/command-controller-dump.test.ts",
																										]
																									: agents
																										? [
																												"packages/coding-agent/test/agent-dashboard.test.ts",
																											]
																										: extensions
																											? [
																													"packages/coding-agent/test/extension-dashboard.test.ts",
																												]
																											: plugin
																												? [
																														"packages/coding-agent/test/slash-commands/plugin-reviewed-actions.test.ts",
																													]
																												: context
																													? [
																															"packages/coding-agent/test/modes/controllers/context-command-controller-review.test.ts",
																														]
																													: mcp
																														? [
																																"packages/coding-agent/test/modes/controllers/mcp-command-controller-review.test.ts",
																																"packages/coding-agent/test/modes/controllers/mcp-command-controller-smithery.test.ts",
																															]
																														: ssh
																															? [
																																	"packages/coding-agent/test/modes/controllers/ssh-command-controller-review.test.ts",
																																]
																															: resourceMutation ||
																																	resourceRead
																																? [
																																		"packages/coding-agent/test/slash-commands/resource-commands-review.test.ts",
																																	]
																																: exportSession || share
																																	? [
																																			"packages/coding-agent/test/modes/controllers/command-controller-export.test.ts",
																																		]
																																	: handoff
																																		? [
																																				"packages/coding-agent/test/modes/controllers/command-controller-handoff.test.ts",
																																			]
																																		: open
																																			? [
																																					"packages/coding-agent/test/modes/controllers/command-controller-open.test.ts",
																																				]
																																			: session
																																				? [
																																						"packages/coding-agent/test/slash-commands/session.test.ts",
																																						"packages/coding-agent/test/modes/controllers/selector-controller-session-delete.test.ts",
																																					]
																																				: branch
																																					? [
																																							"packages/coding-agent/test/modes/controllers/selector-controller-branch.test.ts",
																																						]
																																					: tree
																																						? [
																																								"packages/coding-agent/test/modes/controllers/selector-controller-tree.test.ts",
																																							]
																																						: resume
																																							? [
																																									"packages/coding-agent/test/modes/controllers/selector-controller-resume.test.ts",
																																								]
																																							: handoff
																																								? [
																																										"packages/coding-agent/test/modes/controllers/command-controller-handoff.test.ts",
																																									]
																																								: btw
																																									? [
																																											"packages/coding-agent/test/modes/controllers/btw-controller.test.ts",
																																										]
																																									: [],
		notes: settings
			? [
					"Confirmed pre-correction regressions: hidden section navigator; missing empty-search Left/Right and Space; missing position indicators; choice PageUp/PageDown and mouse behavior removed; incomplete guidance.",
					"The working tree contains the correction candidate; origin/main at the pinned current commit remains the pre-fix comparison source.",
				]
			: manifest
				? [
						"Confirmed pre-fix regression: reviewed manifest confirmation rejects a normal macOS temporary-directory parent after canonicalizing /var to /private/var, while v21.24.4 writes the requested file.",
						"The working-tree correction keeps symlink escape protection while accepting the expected canonical parent.",
					]
				: force
					? [
							"Published v21.24.4 rejects argument-less /force; pre-fix adds a cancel-first active-tool selector. Explicit /force read queues a directive without executing a tool in both versions.",
							"The pre-fix 16-variant terminal matrix covers Cancel, wheel selection, Enter, and no-session persistence; this is an intentional safety addition.",
						]
					: fast
						? [
								"Published /fast on, off, and toggle mutate immediately. Pre-fix retains each command path while adding cancel-first selection and reviewed confirmation before a session-tier change.",
								"The current 16-variant fast matrix proves cancellation and no-op byte preservation, successful enable/disable persistence, and reopen state; this is an intentional safety addition.",
							]
						: route
							? [
									"Published routing modes apply immediately. Pre-fix retains status, mode, profile, and argument paths while adding review, cancellation, persistence retry, no-op, and explicit invalid-input feedback.",
									"The current 16-variant route matrix proves mode/profile cancellation, unavailable-profile non-mutation, unresolved-save retry, persistence, and reopen state; this is an intentional safety addition.",
								]
							: plan
								? [
										"Published bare /plan immediately changes mode and a typed argument submits work. Pre-fix retains both paths but introduces a cancel-first choice and reviewed plan-mode or planning-prompt confirmation.",
										"The current 16-variant plan matrix proves cancellation, persistence/reopen, active-prompt Escape behavior, plan approval, and execution handoff; this is an intentional safety addition.",
									]
								: compact
									? [
											"Published /compact starts immediately and Escape cancels it. Pre-fix adds a cancel-first review, keeps Escape navigation-only while compaction is active, provides explicit Ctrl+C interruption, and prevents a second summary after a successful compaction.",
											"The seeded published-versus-pre-fix receipt proves cancellation/no-op byte preservation, successful persistence and reopen, and the intentional interruption hierarchy; focused compaction tests cover the provider boundary.",
										]
									: reloadPlugins
										? [
												"Published reports a plugin reload. Pre-fix explicitly refreshes command, skill, hook, tool, agent, and MCP metadata without claiming that running plugin processes restarted.",
												"The current 16-variant plugin-metadata matrix proves new command discovery and preserved source bytes; this is an intentional lifecycle redesign.",
											]
										: newSession
											? [
													"Published /new starts a replacement session immediately. Pre-fix retains the operation while adding a cancel-first review of the session-file, active-work, and queued-prompt effects.",
													"The current 16-variant sessions matrix proves cancel makes no file and confirmation makes exactly one persisted session; this is an intentional safety addition.",
												]
											: fork
												? [
														"Published /fork copies the active session immediately. Pre-fix retains the operation while adding a cancel-first review of identity, file, artifact, parent-link, and overwrite effects.",
														"The current 16-variant sessions matrix proves exactly one parent-linked destination; this is an intentional safety addition.",
													]
												: rename
													? [
															"Published /rename requires and applies a title immediately. Pre-fix retains typed titles while adding a Cancel-first review, and makes an editable reviewed dialog discoverable from bare /rename.",
															"The current 16-variant sessions matrix proves rename persistence and reopen; this is an intentional safety addition.",
														]
													: move
														? [
																"Published /move validates a destination and moves immediately. Pre-fix retains valid and invalid destination paths while adding a cancel-first review of working-directory, saved-file, and artifact migration.",
																"The current 16-variant sessions matrix proves move persistence and reopen at the destination; this is an intentional safety addition.",
															]
														: readOnlyReport
															? [
																	`Published /${command} is a read-only report. Pre-fix keeps its report and close behavior while redesigning the shared report frame.`,
																	"The report matrix proves read-only reports do not create reviews or mutate persistence; this is an intentional report redesign.",
																]
															: changelog
																? [
																		"Published /changelog and /changelog full are read-only static output. Pre-fix preserves both paths and adds paged overflow traversal with position indicators.",
																		"The reports matrix proves full changelog paging and no report mutation; this is an intentional report redesign.",
																	]
																: debug
																	? [
																			"Published /debug exposes diagnostic actions directly. Pre-fix retains those actions, adds privacy-safe context, transcript, and artifact-cache options, and uses a selector frame.",
																			"The reports matrix proves cancel-first debug archive creation and bounded output; this is an intentional diagnostic redesign.",
																		]
																	: background
																		? [
																				"Published /background detaches an active foreground session with minimal terminal guidance and aborts an active /btw panel. Pre-fix retains the transfer while preserving all active work, refusing unsafe /btw transfer, reporting the target session and continuation state, and distinguishing unavailable job control.",
																				"The dedicated 16-variant matrix proves POSIX stop/background resume, one provider request, completed response persistence, and reopen. This is an intentional lifecycle-safety addition.",
																			]
																		: memory
																			? [
																					"Published /memory clear, reset, enqueue, and rebuild mutate immediately. Pre-fix retains all spellings while adding Cancel-first reviewed actions, stale-target rejection, unresolved-only retry guidance, and explicit scope/consequence disclosure; /memory view becomes a paged report.",
																					"The 16-variant memory-actions matrix covers view paging, Escape, clear/reset/enqueue/rebuild cancellation and success, invalid input, persistence, stale-state protection, and artifact removal. This is an intentional mutation-safety addition with a view-frame redesign.",
																				]
																			: reviewedExit
																				? [
																						"Published /exit and /quit terminate directly. Pre-fix retains both commands while adding a Cancel-first review of active responses, queued prompts, compaction, handoff, and async-job settlement before shutdown.",
																						"The 16-variant reviewed-exit matrix proves both command spellings, cancellation byte preservation, explicit confirmation, interrupted work settlement, and a clean process exit; this is an intentional lifecycle-safety addition.",
																					]
																				: media
																					? [
																							"Published and pre-fix retain the same play, pause, stop, latest-id, missing-media, and invalid-action handler contract. The pre-fix bare-command PTY capture produced no visible status; the current capture adds explicit usage guidance without removing a registered operation.",
																							"The pinned no-media receipt covers bare and every registered subcommand at 80x24; the current 16-variant reports matrix covers seeded playback, invalid input, byte-preservation, and reopen separately.",
																						]
																					: providerCredentialAction
																						? [
																								`Published /${command} invokes its provider workflow directly. Pre-fix retains the provider choices and typed paths but adds a cancel-first credential or connection review, explicit stale-state protection, and masked credential disclosure.`,
																								"The pinned receipt establishes each command opens and cancels in both versions. The candidate 16-variant foundation matrix covers provider sign-in, LiteLLM persistence, cancellation, provider-model handoff, credential removal, and reopen; this is an intentional credential-safety addition.",
																							]
																						: model
																							? [
																									"Published /model and /models persist a selected model directly. Pre-fix retains both spellings, selector controls, scopes, and role assignments while adding a Cancel-first review, stale-target resolution, explicit no-op feedback, and retry guidance for unresolved persistence.",
																									"The candidate 16-variant foundation matrix covers conversation/default/role scopes, cancel, save, no-op, persistence/reopen, and both spellings; the focused selector test confirms no model or settings write occurs before review. This is an intentional model-selection safety addition.",
																								]
																							: browser
																								? [
																										"Published /browser mutates the preferred browser mode immediately and may restart a browser before reporting an error. Pre-fix adds an explicit Cancel-first mode choice, reviewed setting changes, stale-target protection, and an additive read-only status path.",
																										"The candidate browser/Chrome matrix covers cancellation, save, no-op, status, invalid input, reset failure/retry, and persisted mode across all 16 variants; this is an intentional browser-preference safety addition.",
																									]
																								: chrome
																									? [
																											"Published /chrome relaunch delegates directly to the lifecycle CLI. Pre-fix retains status and relaunch while adding explicit endpoint inspection, a Cancel-first access review, attachment failure containment, and retry after endpoint recovery.",
																											"The candidate browser/Chrome matrix proves status is probe-only; cancellation avoids attachment; confirmed access attaches only to the reviewed loopback endpoint; failures remain unresolved until a renewed review succeeds. This is an intentional browser-access safety redesign.",
																										]
																									: clipboardAction
																										? [
																												`Published /${command} writes directly to the system clipboard. Pre-fix retains every copy target while adding a Cancel-first review, exact clipboard scope, stale-content protection, retry guidance, and explicit platform disclosure.`,
																												"The isolated Xvfb matrix independently reads the clipboard after cancellation and success for every copy target, verifies transcript bytes remain unchanged and reopens the session. This is an intentional clipboard-safety addition.",
																											]
																										: open
																											? [
																													"Published /open launches the latest transcript link directly. Pre-fix preserves that target while adding a Cancel-first external-link review, stale-target detection, literal launcher arguments, and unresolved-only retry.",
																													"The isolated publication/launcher matrix proves cancellation performs no launch, a stale link renews review, success launches only the reviewed URL, and a launcher failure retries only the unresolved operation. This is an intentional external-launch safety addition.",
																												]
																											: session
																												? [
																														"Published /session info remains a non-mutating report; pre-fix uses the paged report frame. Published deletion uses a basic confirmation, while pre-fix reviews exact files and artifacts, detects stale targets, detaches active sessions safely, and retains partial cleanup for retry.",
																														"The candidate sessions matrix verifies session-report browsing plus exact deletion-safe lifecycle boundaries alongside reopen checks; this combines an intentional report redesign with a deletion-safety addition.",
																													]
																												: branch
																													? [
																															"Published /branch conditionally opens tree navigation or a message selector. Pre-fix consistently exposes the user-message branch browser with exact-node details and a Cancel-first creation review.",
																															"The candidate sessions matrix proves searched branch selection, cancellation without a new file, exactly one parent-linked branch after confirmation, and responsive rendering. This is an intentional navigation redesign with safe creation.",
																														]
																													: tree
																														? [
																																"Published tree navigation can transition directly after its summary choice. Pre-fix retains tree reachability while adding exact-node details, Cancel-first reviewed navigation, stale-target checks, explicit progress, and persisted branch-summary verification.",
																																"The candidate sessions matrix proves Ctrl+C remains execution control, navigation cancellation preserves bytes, and confirmed summary navigation persists exactly once. This is an intentional session-navigation safety addition.",
																															]
																														: resume
																															? [
																																	"Published /resume switches to the selected session directly. Pre-fix retains scopes, search, and session details while adding a Cancel-first exact-identity resume review and stale-target revalidation.",
																																	"The candidate sessions matrix proves scoped search, cancelled resume, confirmed identity switch, and reopen. This is an intentional resume-safety addition.",
																																]
																															: agents
																																? [
																																		"Published /agents opens the agent inventory. Pre-fix retains it while adding an inspected, searchable control center with scoped rows, Cancel-first enablement and model changes, source-drift checks, and retryable persistence failures.",
																																		"The agent dashboard tests cover keyboard, Escape, cancellation, stale metadata, exact persisted settings, and retry; this is an intentional agent-management safety addition.",
																																	]
																																: extensions
																																	? [
																																			"Published /extensions and /status open the extension inventory. Pre-fix retains both spellings while adding scoped inspection, tabs and search, Cancel-first changes, source-drift renewal, and persistence recovery.",
																																			"The extension dashboard tests and 16-variant inventory capture cover navigation, Escape, refresh, stale completion, reviewed changes, save, and reopen; this is an intentional extension-management safety addition.",
																																		]
																																	: plugin
																																		? [
																																				"Published plugin, marketplace, and plugin lifecycle commands act through their existing registry paths. Pre-fix retains every alias and subcommand while adding scoped selectors and reports, Cancel-first install/remove/enable/disable/upgrade/setup reviews, catalog-drift checks, exact persistence, and unresolved-only retry.",
																																				"The plugin lifecycle and metadata-refresh 16-variant matrices prove cancellation, no-op preservation, replacement-not-consent force semantics, persistence/reopen, and explicit refresh behavior; this is an intentional lifecycle-safety addition with read-surface redesigns.",
																																			]
																																		: context
																																			? [
																																					"Published context commands directly change saved or active connection state. Pre-fix retains all baseline subcommands, adds explicit link and unlink paths, keeps reports bounded, and moves every persistent or active-context change behind a Cancel-first, secret-masked, stale-aware review with unresolved-only retry.",
																																					"Focused context-controller tests cover all baseline mutation classes, reports, secret masking, stale state, partial wizard recovery, and additive pointer operations; this is an intentional connection-safety addition with report redesigns.",
																																				]
																																			: mcp
																																				? [
																																						"Published MCP commands mutate saved servers and authorization directly. Pre-fix retains each baseline spelling while adding Cancel-first configuration and OAuth reviews, drift checks, separated saved-versus-runtime outcomes, explicit interrupt hierarchy for browser authorization, bounded reports, and unresolved-only retry.",
																																						"The MCP controller and Smithery tests cover configuration and credential cancellation, persistence, stale targets, failures, reports, duplicate work, and explicit interruption; this is an intentional client-management safety addition with report redesigns.",
																																					]
																																				: ssh
																																					? [
																																							"Published SSH add and remove mutate saved host configuration directly. Pre-fix retains add, list, remove, and help while adding Cancel-first exact-scope reviews, stale-target checks, retryable persistence failures, and bounded list/help reports that distinguish saved configuration from connectivity.",
																																							"Focused SSH-controller tests cover cancellation, confirmation, stale targets, unresolved write retry, non-destructive removal, and list/help report controls; this is an intentional host-configuration safety addition with report redesigns.",
																																						]
																																					: resourceMutation
																																						? [
																																								"Published resource mutation commands execute after input validation. Pre-fix preserves the syntax and dry-run paths while adding a Cancel-first resolved-target review, credential and manifest revision checks, stale-target protection, observed completion reports, and unresolved-only retry.",
																																								"The pinned loopback differential proves published Escape occurs after the direct write whereas pre-fix cancellation performs no remote write; confirmation, read-only dry-run, failure, and retry behavior are retained. This is an intentional remote-mutation safety addition.",
																																							]
																																						: resourceRead
																																							? [
																																									"Published /describe, /diff, and /get perform the same read-only resource requests. Pre-fix retains valid, empty, and failing request paths while presenting bounded paged reports with explicit close guidance.",
																																									"The pinned loopback differential proves the three read surfaces keep one request and unchanged remote state, while client dry-run remains non-mutating. This is an intentional report-frame redesign.",
																																								]
																																							: exportSession
																																								? [
																																										"Published /export writes and opens an HTML transcript directly. Pre-fix retains the destination syntax while adding a Cancel-first exact-file review, stale-destination checks, atomic 0600 writes, no-op detection, and unresolved-only retry.",
																																										"The candidate publication matrix proves cancellation, unchanged-file preservation, stale-file rejection, partial-write recovery, saved-before-open-failure guidance, permissions, and session reopen across all 16 variants; this is an intentional local-export safety addition.",
																																									]
																																								: share
																																									? [
																																											"Published /share stages and publishes the transcript immediately. Pre-fix retains the publication route while adding a Cancel-first remote-publication review, handler revision check, stale-session protection, cleanup, explicit sensitive-content disclosure, failure retry, and no automatic URL launch.",
																																											"The candidate publication matrix proves no publish on cancellation, failed-publication retry, staging cleanup, URL-only success, and reopen across all 16 variants; this is an intentional remote-publication safety addition.",
																																										]
																																									: handoff
																																										? [
																																												"Published /handoff begins generation and the session transition directly. Pre-fix retains typed instructions while adding a Cancel-first exact-destination review, explicit cost and background-job disclosure, interrupt-only Ctrl+C during generation, and an unresolved-transition retry that does not regenerate or bill another handoff.",
																																												"The candidate sessions matrix proves cancellation avoids model work, confirmed handoff reopens the exact context-bearing destination, and retry preserves the already-generated handoff; this is an intentional lifecycle-safety addition.",
																																											]
																																										: btw
																																											? [
																																													"Published Escape aborts an active /btw side request and permits immediate replacement. Pre-fix makes Escape navigation-only, introduces an explicit interrupt path, rejects duplicate starts, and blocks background transfer while a request remains running.",
																																													"This is an intentional interruption-safety redesign: the focused controller test and 16-variant reports matrix retain completion, failure, retry, explicit interruption, and persistence boundaries.",
																																												]
																																											: [],
	};
});

const ledger = {
	schemaVersion: 1,
	status: "complete",
	baseline: { version: BASELINE_VERSION, commit: BASELINE_COMMIT },
	current: { ref: "origin/main", version: "v21.25.0", commit: CURRENT_COMMIT },
	comparisonPolicy:
		"Published baseline versus immutable pre-fix current source. Candidate evidence is separate and cannot satisfy baseline/current parity receipts.",
	differentialReceipts: [
		{
			path: "packages/coding-agent/test/evidence/slash-command-discovery-differential-v1/receipts.json",
			kind: "interactive-discovery-only",
			coverage: "All top-level commands, aliases, and registered subcommands typed at 80x24.",
			limitation:
				"Discovery proves completion-row reachability only; it does not prove execution, cancellation, mutation, persistence, retry, interruption, or behavioral parity.",
		},
		{
			path: "packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/receipts.json",
			kind: "interactive-all-surfaces-open-cancel-only",
			coverage:
				"All top-level commands, aliases, and registered subcommands entered at 80x24 in isolated real PTYs.",
			limitation:
				"Open/cancel proves neither selectable-row coverage nor success, failure, persistence, retry, interruption, or full behavioral parity; retained startup timeouts are resolved only by the paired retry receipt.",
		},
		{
			path: "packages/coding-agent/test/evidence/slash-command-all-surfaces-open-cancel-differential-v1/retry-receipts.json",
			kind: "interactive-all-surfaces-open-cancel-only-retry",
			coverage:
				"The six transient pre-fix no-byte startup timeouts from the all-surface capture, retried successfully in both candidates.",
			limitation: "Retry establishes harness recovery, not command semantic parity.",
		},
		{
			path: "packages/coding-agent/test/evidence/resource-cli-differential-v1/receipt.json",
			kind: "resource-cli-contract-differential",
			coverage:
				"Published and pre-fix public resource CLI validation, update, failure exit-code, credentials, and manifest-export contracts.",
			limitation:
				"This supports resource-operation parity but does not establish interactive slash-command review, cancellation, persistence, retry, or full TUI parity.",
		},
		{
			path: "packages/coding-agent/test/evidence/client-resources-differential-v1/receipt.json",
			kind: "mcp-client-resource-contract-differential",
			coverage:
				"Published and pre-fix MCP resource-client capabilities, caching, pagination, reads, subscriptions, unsubscriptions, and failure isolation.",
			limitation:
				"This supports the MCP resource-client substrate but does not establish interactive /mcp navigation, cancellation, mutation, retry, persistence, or full TUI parity.",
		},
		{
			path: "packages/coding-agent/test/evidence/resource-review-differential-v1/receipt.json",
			kind: "interactive-resource-review-differential",
			coverage:
				"Real-PTY /get, /describe, /diff, /manifest, /create, /apply --dry-run=client, and /delete requests, reports, cancellation, explicit confirmation, client-dry-run non-mutation, manifest-write effects, and an injected delete-failure/retry recovery against one disposable loopback resource backend in both pinned candidates.",
			limitation:
				"The pre-fix manifest confirmation is a confirmed macOS canonical-parent regression: it fails after review because /var resolves to /private/var; the candidate's symlink-safe validation has a focused regression test. Bulk-resource partial failure, stale state, persistence/reopen, interruption, and the remaining resource UAT work are still required.",
		},
		{
			path: "packages/coding-agent/test/evidence/settings-navigation-differential-v1/receipt.json",
			kind: "interactive-settings-navigation-differential",
			coverage:
				"Real-PTY /settings open, empty-search Left/Right, Space, Enter, PageDown, SGR mouse motion/wheel/click, Escape, and configuration-byte observation at 80x24 in the published and immutable pre-fix sources.",
			limitation:
				"This confirms the pre-fix loss of the published navigator and keyboard semantics. The correction candidate's focused settings tests and 16-variant matrix are separate; every setting row and choice list still requires final candidate recapture.",
		},
		{
			path: "packages/coding-agent/test/evidence/report-runtime-keyboard-differential-v1/receipts.json",
			kind: "interactive-report-runtime-keyboard-differential",
			coverage:
				"Real-PTY /changelog, /debug, /hotkeys, /jobs, /media, /tools, and /usage open, Down, PageDown, Up, and Escape states at 80x24 in both pinned sources.",
			limitation:
				"This extends open/cancel evidence with keyboard state captures, but it does not cover every selectable row, action outcome, persistence, failure, retry, interruption, or responsive variant. The rows remain pending until that full semantic UAT is complete.",
		},
		{
			path: "packages/coding-agent/test/evidence/media-differential-v1/receipts.json",
			kind: "interactive-top-level-open-cancel-only",
			coverage:
				"Published and pre-fix /media plus every registered play, pause, and stop surface in an empty disposable transcript at 80x24, including keyboard and Escape captures.",
			limitation:
				"The empty-transcript receipt proves invalid and no-media behavior only. Seeded current-candidate play, pause, stop, invalid-action, byte-preservation, reopen, and responsive evidence is retained separately in terminal-reports-final-v1; the identical pinned command handler establishes the cross-version playback contract.",
		},
		{
			path: "packages/coding-agent/test/evidence/background-keyboard-differential-v1/receipts.json",
			kind: "interactive-top-level-open-cancel-only",
			coverage:
				"Published and pre-fix /background and /bg idle-state handling at 80x24, including keyboard and Escape captures.",
			limitation:
				"The differential receipt covers only the idle guard. The current-candidate 16-variant matrix provides active-transfer, POSIX stop/background resume, completion, persistence, and reopen evidence; the source comparison establishes the intended cross-version lifecycle transition.",
		},
		{
			path: "packages/coding-agent/test/evidence/slash-command-handler-differential-v1/receipt.json",
			kind: "direct-slash-command-handler-differential",
			coverage: "Published and pre-fix direct handler contracts for force, login, BTW, session, and copy/open.",
			limitation:
				"This establishes handler-level behavior only; terminal rendering, mouse input, responsive layout, persistence, and every selectable-row path remain separate UAT requirements.",
		},
		{
			path: "packages/coding-agent/test/evidence/force-differential-v1/receipt.json",
			kind: "interactive-force-differential",
			coverage:
				"Real-PTY published and pre-fix /force empty-invocation cancellation plus explicit read queueing at 80x24, paired with a current 16-variant matrix covering Cancel, wheel selection, Enter, and no-session persistence.",
			limitation:
				"This classifies the deliberate /force safety addition; it does not establish parity for unrelated commands or future tools added to the selector.",
		},
		{
			path: "packages/coding-agent/test/evidence/fast-differential-v1/receipts.json",
			kind: "interactive-fast-command-differential",
			coverage:
				"Real-PTY published and pre-fix /fast, /fast status, /fast on, /fast off, and /fast toggle open/cancel and keyboard states at 80x24.",
			limitation:
				"The detailed persistence, no-op, and responsive evidence belongs to the separate current-candidate fast matrix; this receipt establishes the pinned cross-version command-path difference.",
		},
		{
			path: "packages/coding-agent/test/evidence/route-differential-v1/receipts.json",
			kind: "interactive-route-command-differential",
			coverage:
				"Real-PTY published and pre-fix /route, status, off, shadow, auto, profile, and invalid command paths open/cancel and keyboard states at 80x24.",
			limitation:
				"The detailed persistence, profile resolution, no-op, unavailable profile, and responsive evidence belongs to the separate current-candidate route matrix; this receipt establishes the pinned cross-version command-path difference.",
		},
		{
			path: "packages/coding-agent/test/evidence/plan-differential-v1/receipts.json",
			kind: "interactive-plan-command-differential",
			coverage:
				"Real-PTY published and pre-fix bare /plan plus a typed planning-prompt path, including open/cancel and keyboard states at 80x24.",
			limitation:
				"The detailed persistence, plan approval, interruption, and responsive evidence belongs to the separate current-candidate plan matrix; this receipt establishes the pinned cross-version command-path difference.",
		},
		{
			path: "packages/coding-agent/test/evidence/compact-differential-v1/receipts.json",
			kind: "interactive-compact-empty-session-differential",
			coverage:
				"Real-PTY published and pre-fix bare /compact plus typed custom instructions in a disposable empty session at 80x24.",
			limitation:
				"This retains the observed empty-session message-threshold difference only; the paired seeded-session receipt supplies the classified success, cancellation, interruption, persistence, reopen, and no-op paths.",
		},
		{
			path: "packages/coding-agent/test/evidence/compact-seeded-differential-v1/receipt.json",
			kind: "interactive-compact-seeded-differential",
			coverage:
				"Real-PTY seeded-session /compact in published and pre-fix sources: review/cancel, Escape, explicit Ctrl+C interruption, success, persisted-session reopen, and already-compacted no-op at 80x24.",
			limitation:
				"The controlled provider covers a valid response only; provider HTTP failures and retry semantics remain covered by focused compaction tests, and the final candidate responsive recapture remains separate.",
		},
		{
			path: "packages/coding-agent/test/evidence/foundation-login-model-differential-v1/receipts.json",
			kind: "interactive-login-model-open-cancel-differential",
			coverage:
				"Real-PTY published and pre-fix /login, /login litellm, /logout, /model, and /models open/cancel and keyboard states at 80x24.",
			limitation:
				"The unconfigured LiteLLM path is timing-sensitive in this generic harness. Seeded provider connection, credential handling, model selection, failure/retry, persistence, reopen, and responsive comparisons remain required before classification.",
		},
		{
			path: "packages/coding-agent/test/evidence/reload-plugins-differential-v1/receipts.json",
			kind: "interactive-reload-plugins-differential",
			coverage: "Real-PTY published and pre-fix /reload-plugins execution and keyboard state at 80x24.",
			limitation:
				"The dynamic discovery and responsive evidence belongs to the separate current-candidate plugin-metadata matrix; this receipt establishes the pinned lifecycle wording and behavior difference.",
		},
		{
			path: "packages/coding-agent/test/evidence/new-differential-v1/receipts.json",
			kind: "interactive-new-session-differential",
			coverage: "Real-PTY published and pre-fix /new execution and keyboard state at 80x24.",
			limitation:
				"The seeded-session persistence, cancellation, and responsive evidence belongs to the separate current-candidate sessions matrix; this receipt establishes the pinned cross-version immediate-versus-reviewed transition.",
		},
		{
			path: "packages/coding-agent/test/evidence/fork-differential-v1/receipts.json",
			kind: "interactive-fork-differential",
			coverage: "Real-PTY published and pre-fix /fork execution and keyboard state at 80x24.",
			limitation:
				"The seeded-session artifact, parent-link, collision, persistence, and responsive evidence belongs to the separate current-candidate sessions matrix; this receipt establishes the pinned cross-version immediate-versus-reviewed transition.",
		},
		{
			path: "packages/coding-agent/test/evidence/coding-agent-test-differential-v1/receipt.json",
			kind: "full-coding-agent-test-differential",
			coverage: "Published and pre-fix complete coding-agent test trees in isolated source-matched checkouts.",
			limitation:
				"Both runs exited nonzero and remain failed evidence. This broad source-contract receipt is not an interactive slash-command parity result and does not satisfy the final full-test gate.",
		},
	],
	candidateReceipts: [
		{
			path: "packages/coding-agent/test/evidence/working-resource-uat-v1/receipt.json",
			kind: "working-tree-resource-terminal-uat",
			limitation:
				"Candidate-only validation of the correction tree. It cannot be used as published-baseline versus pre-fix parity proof.",
		},
		{
			path: "packages/coding-agent/test/evidence/terminal-settings-inventories-final-v1/matrix.json",
			kind: "working-tree-responsive-matrix",
			limitation:
				"Candidate-only 16-variant visual validation. It cannot establish published-baseline versus pre-fix semantic or behavioral parity.",
		},
		{
			path: "packages/coding-agent/test/evidence/working-smoke-v1/receipt.json",
			kind: "working-tree-cli-smoke",
			limitation:
				"Candidate-only smoke validation. It cannot establish published-baseline versus pre-fix semantic or behavioral parity.",
		},
		{
			path: "packages/coding-agent/test/evidence/working-types-v1/receipt.json",
			kind: "working-tree-typescript-tools",
			limitation:
				"Candidate-only TypeScript validation. It cannot establish published-baseline versus pre-fix semantic or behavioral parity.",
		},
		{
			path: "packages/coding-agent/test/evidence/working-full-workspace-test-v1/receipt.json",
			kind: "working-tree-full-workspace-test",
			limitation:
				"Preserved failed candidate-only full-test receipt: the stale generated source-boundary audit was repaired afterward, but the complete workspace gate must be rerun. It cannot establish published-baseline versus pre-fix semantic or behavioral parity.",
		},
		{
			path: "packages/coding-agent/test/evidence/working-full-workspace-test-v2/receipt.json",
			kind: "working-tree-full-workspace-test",
			limitation:
				"Passing candidate-only full-workspace validation. It cannot establish published-baseline versus pre-fix semantic or behavioral parity.",
		},
		{
			path: "packages/coding-agent/test/evidence/working-full-workspace-test-v3/receipt.json",
			kind: "working-tree-full-workspace-test",
			limitation:
				"Final passing candidate-only full-workspace validation after the resource-review receipt type repair. It cannot establish published-baseline versus pre-fix semantic or behavioral parity.",
		},
		{
			path: "packages/coding-agent/test/evidence/working-full-workspace-test-v4/receipt.json",
			kind: "working-tree-full-workspace-test",
			limitation:
				"Final passing candidate-only full-workspace validation after freezing the parity ledger and enforcing every responsive matrix. It cannot establish published-baseline versus pre-fix semantic or behavioral parity.",
		},
		{
			path: "packages/coding-agent/test/evidence/terminal-memory-fast-final-v1/matrix.json",
			kind: "working-tree-fast-responsive-matrix",
			limitation:
				"Candidate-only 16-variant fast-mode validation. It validates the correction candidate's reviewed safety behavior but cannot establish published-baseline versus pre-fix semantic parity by itself.",
		},
		{
			path: "packages/coding-agent/test/evidence/terminal-route-mode-final-v1/matrix.json",
			kind: "working-tree-route-responsive-matrix",
			limitation:
				"Candidate-only 16-variant route validation. It validates the correction candidate's reviewed routing behavior but cannot establish published-baseline versus pre-fix semantic parity by itself.",
		},
		{
			path: "packages/coding-agent/test/evidence/terminal-plan-mode-final-v1/matrix.json",
			kind: "working-tree-plan-responsive-matrix",
			limitation:
				"Candidate-only 16-variant plan-mode validation. It validates the correction candidate's reviewed plan behavior but cannot establish published-baseline versus pre-fix semantic parity by itself.",
		},
		{
			path: "packages/coding-agent/test/evidence/terminal-plugin-metadata-refresh-final-v1/matrix.json",
			kind: "working-tree-plugin-metadata-responsive-matrix",
			limitation:
				"Candidate-only 16-variant plugin-metadata validation. It validates the correction candidate's discovery behavior but cannot establish published-baseline versus pre-fix semantic parity by itself.",
		},
		{
			path: "packages/coding-agent/test/evidence/terminal-sessions-final-v1/matrix.json",
			kind: "working-tree-sessions-responsive-matrix",
			limitation:
				"Candidate-only 16-variant session-lifecycle validation. It validates the correction candidate's reviewed session behavior but cannot establish published-baseline versus pre-fix semantic parity by itself.",
		},
		{
			path: "packages/coding-agent/test/evidence/terminal-reports-final-v1/matrix.json",
			kind: "working-tree-report-runtime-responsive-matrix",
			limitation:
				"Candidate-only 16-variant report/runtime validation. It validates /btw interruption, completion, failure, retry, transcript byte preservation, and reopen behavior but cannot establish published-baseline versus pre-fix semantic parity by itself.",
		},
		{
			path: "packages/coding-agent/test/evidence/terminal-background-transfer-final-v1/matrix.json",
			kind: "working-tree-background-transfer-responsive-matrix",
			limitation:
				"Candidate-only 16-variant background-transfer validation. It validates current lifecycle safety but cannot establish published-baseline versus pre-fix semantic parity by itself.",
		},
		{
			path: "packages/coding-agent/test/evidence/terminal-reviewed-exit-final-v1/matrix.json",
			kind: "working-tree-reviewed-exit-responsive-matrix",
			limitation:
				"Candidate-only 16-variant reviewed-exit validation. It validates current lifecycle safety but cannot establish published-baseline versus pre-fix semantic parity by itself.",
		},
		{
			path: "packages/coding-agent/test/evidence/terminal-memory-actions-final-v1/matrix.json",
			kind: "working-tree-memory-actions-responsive-matrix",
			limitation:
				"Candidate-only 16-variant memory-action validation. It validates current mutation safety but cannot establish published-baseline versus pre-fix semantic parity by itself.",
		},
		{
			path: "packages/coding-agent/test/evidence/terminal-foundation-login-model-final-v1/matrix.json",
			kind: "working-tree-foundation-login-model-responsive-matrix",
			limitation:
				"Candidate-only 16-variant provider and model workflow validation. It covers reviewed credentials, LiteLLM, model scopes, persistence, reopen, no-op, and logout but cannot establish published-baseline versus pre-fix parity by itself.",
		},
		{
			path: "packages/coding-agent/test/evidence/terminal-browser-chrome-final-v1/matrix.json",
			kind: "working-tree-browser-chrome-responsive-matrix",
			limitation:
				"Candidate-only 16-variant browser preference and Chrome access validation. It covers cancellation, persistence, status, no-op, endpoint attachment, failure containment, and retry but cannot establish published-baseline versus pre-fix parity by itself.",
		},
		{
			path: "packages/coding-agent/test/evidence/terminal-copy-clipboard-final-v1/matrix.json",
			kind: "working-tree-copy-clipboard-responsive-matrix",
			limitation:
				"Candidate-only 16-variant clipboard validation. It independently reads clipboard results and covers cancellation, exact targets, no-mutation, persistence, and reopen but cannot establish published-baseline versus pre-fix parity by itself.",
		},
		{
			path: "packages/coding-agent/test/evidence/terminal-publication-launcher-final-v1/matrix.json",
			kind: "working-tree-publication-launcher-responsive-matrix",
			limitation:
				"Candidate-only 16-variant publication, export, and external-launch validation. It proves reviewed launcher behavior but cannot establish published-baseline versus pre-fix parity by itself.",
		},
	],
	responsiveMatrix: {
		sizes: ["60x20", "80x24", "100x32", "140x40"],
		themes: ["dark", "light"],
		characterSets: ["unicode", "ascii"],
		expectedVariants: 16,
	},
	preExistingGaps: [
		{
			id: "settings-status-line-segment-editor",
			classification: "pre-existing-feature-gap",
			note: "The deleted editor was already unreachable in v21.24.4 and is excluded from refactor parity remediation.",
		},
	],
	entries,
};

if (entries.length !== 51) throw new Error(`Expected 51 commands, found ${entries.length}`);
await Bun.write(output, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ output, commands: entries.length, baseline: BASELINE_COMMIT, current: CURRENT_COMMIT }));
