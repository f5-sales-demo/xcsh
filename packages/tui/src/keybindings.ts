import { type ChordBinding, parseBinding } from "./chord-parser";
import { type KeyId, matchesKey, parseKey } from "./keys";

/**
 * Global keybinding registry.
 * Downstream packages can add keybindings via declaration merging.
 */
export interface Keybindings {
	// Editor navigation and editing
	"tui.editor.cursorUp": true;
	"tui.editor.cursorDown": true;
	"tui.editor.cursorLeft": true;
	"tui.editor.cursorRight": true;
	"tui.editor.cursorWordLeft": true;
	"tui.editor.cursorWordRight": true;
	"tui.editor.cursorLineStart": true;
	"tui.editor.cursorLineEnd": true;
	"tui.editor.jumpForward": true;
	"tui.editor.jumpBackward": true;
	"tui.editor.pageUp": true;
	"tui.editor.pageDown": true;
	"tui.editor.deleteCharBackward": true;
	"tui.editor.deleteCharForward": true;
	"tui.editor.deleteWordBackward": true;
	"tui.editor.deleteWordForward": true;
	"tui.editor.deleteToLineStart": true;
	"tui.editor.deleteToLineEnd": true;
	"tui.editor.yank": true;
	"tui.editor.yankPop": true;
	"tui.editor.undo": true;
	// Generic input actions
	"tui.input.newLine": true;
	"tui.input.submit": true;
	"tui.input.tab": true;
	"tui.input.copy": true;
	// Generic selection actions
	"tui.select.up": true;
	"tui.select.down": true;
	"tui.select.pageUp": true;
	"tui.select.pageDown": true;
	"tui.select.confirm": true;
	"tui.select.cancel": true;
}

export type Keybinding = keyof Keybindings;

// Re-export KeyId from keys.ts
export type { KeyId };

/**
 * Binding string accepted by the config layer. Single-stroke values are
 * KeyId (strict template-literal union); chord-syntax values (e.g.
 * "ctrl+x b") are plain strings validated at runtime by parseBinding.
 */
export type BindingString = KeyId | string;

export interface KeybindingDefinition {
	defaultKeys: BindingString | BindingString[];
	description?: string;
}

export type KeybindingDefinitions = Record<string, KeybindingDefinition>;
export type KeybindingsConfig = Record<string, BindingString | BindingString[] | undefined>;

export const TUI_KEYBINDINGS = {
	"tui.editor.cursorUp": { defaultKeys: "up", description: "Move cursor up" },
	"tui.editor.cursorDown": { defaultKeys: "down", description: "Move cursor down" },
	"tui.editor.cursorLeft": {
		defaultKeys: ["left", "ctrl+b"],
		description: "Move cursor left",
	},
	"tui.editor.cursorRight": {
		defaultKeys: ["right", "ctrl+f"],
		description: "Move cursor right",
	},
	"tui.editor.cursorWordLeft": {
		defaultKeys: ["alt+left", "ctrl+left", "alt+b"],
		description: "Move cursor word left",
	},
	"tui.editor.cursorWordRight": {
		defaultKeys: ["alt+right", "ctrl+right", "alt+f"],
		description: "Move cursor word right",
	},
	"tui.editor.cursorLineStart": {
		defaultKeys: ["home", "ctrl+a"],
		description: "Move to line start",
	},
	"tui.editor.cursorLineEnd": {
		defaultKeys: ["end", "ctrl+e"],
		description: "Move to line end",
	},
	"tui.editor.jumpForward": {
		defaultKeys: "ctrl+]",
		description: "Jump forward to character",
	},
	"tui.editor.jumpBackward": {
		defaultKeys: "ctrl+alt+]",
		description: "Jump backward to character",
	},
	"tui.editor.pageUp": { defaultKeys: "pageUp", description: "Page up" },
	"tui.editor.pageDown": { defaultKeys: "pageDown", description: "Page down" },
	"tui.editor.deleteCharBackward": {
		defaultKeys: "backspace",
		description: "Delete character backward",
	},
	"tui.editor.deleteCharForward": {
		defaultKeys: ["delete", "ctrl+d"],
		description: "Delete character forward",
	},
	"tui.editor.deleteWordBackward": {
		defaultKeys: ["ctrl+w", "alt+backspace", "ctrl+backspace"],
		description: "Delete word backward",
	},
	"tui.editor.deleteWordForward": {
		defaultKeys: ["alt+delete", "alt+d"],
		description: "Delete word forward",
	},
	"tui.editor.deleteToLineStart": {
		defaultKeys: "ctrl+u",
		description: "Delete to line start",
	},
	"tui.editor.deleteToLineEnd": {
		defaultKeys: "ctrl+k",
		description: "Delete to line end",
	},
	"tui.editor.yank": { defaultKeys: "ctrl+y", description: "Yank" },
	"tui.editor.yankPop": { defaultKeys: "alt+y", description: "Yank pop" },
	"tui.editor.undo": { defaultKeys: ["ctrl+-", "ctrl+_"], description: "Undo" },
	"tui.input.newLine": { defaultKeys: "shift+enter", description: "Insert newline" },
	"tui.input.submit": { defaultKeys: "enter", description: "Submit input" },
	"tui.input.tab": { defaultKeys: "tab", description: "Tab / autocomplete" },
	"tui.input.copy": { defaultKeys: "ctrl+c", description: "Copy selection" },
	"tui.select.up": { defaultKeys: "up", description: "Move selection up" },
	"tui.select.down": { defaultKeys: "down", description: "Move selection down" },
	"tui.select.pageUp": { defaultKeys: "pageUp", description: "Selection page up" },
	"tui.select.pageDown": {
		defaultKeys: "pageDown",
		description: "Selection page down",
	},
	"tui.select.confirm": { defaultKeys: "enter", description: "Confirm selection" },
	"tui.select.cancel": {
		defaultKeys: ["escape", "ctrl+c"],
		description: "Cancel selection",
	},
} as const satisfies KeybindingDefinitions;

export interface KeybindingConflict {
	key: KeyId;
	keybindings: string[];
}

const SHIFTED_SYMBOL_KEYS = new Set<string>([
	"!",
	"@",
	"#",
	"$",
	"%",
	"^",
	"&",
	"*",
	"(",
	")",
	"_",
	"+",
	"{",
	"}",
	"|",
	":",
	"<",
	">",
	"?",
	"~",
]);

const normalizeKeyId = (key: BindingString): KeyId => key.toLowerCase() as KeyId;

function normalizeKeys(keys: BindingString | BindingString[] | undefined): KeyId[] {
	if (keys === undefined) return [];
	const keyList = Array.isArray(keys) ? keys : [keys];
	const seen = new Set<KeyId>();
	const result: KeyId[] = [];
	for (const key of keyList) {
		const normalized = normalizeKeyId(key);
		if (!seen.has(normalized)) {
			seen.add(normalized);
			result.push(normalized);
		}
	}
	return result;
}

export class KeybindingsManager {
	#definitions: KeybindingDefinitions;
	#userBindings: KeybindingsConfig;
	#keysById = new Map<Keybinding, KeyId[]>();
	#conflicts: KeybindingConflict[] = [];

	constructor(definitions: KeybindingDefinitions, userBindings: KeybindingsConfig = {}) {
		this.#definitions = definitions;
		this.#userBindings = userBindings;
		this.#rebuild();
	}

	#rebuild(): void {
		this.#keysById.clear();
		this.#conflicts = [];

		const userClaims = new Map<KeyId, Set<Keybinding>>();
		for (const [keybinding, keys] of Object.entries(this.#userBindings)) {
			if (!(keybinding in this.#definitions)) continue;
			for (const key of normalizeKeys(keys)) {
				const claimants = userClaims.get(key) ?? new Set<Keybinding>();
				claimants.add(keybinding as Keybinding);
				userClaims.set(key, claimants);
			}
		}

		for (const [key, keybindings] of userClaims) {
			if (keybindings.size > 1) {
				this.#conflicts.push({ key, keybindings: [...keybindings] });
			}
		}

		for (const [id, definition] of Object.entries(this.#definitions)) {
			const userKeys = this.#userBindings[id];
			const keys = userKeys === undefined ? normalizeKeys(definition.defaultKeys) : normalizeKeys(userKeys);
			this.#keysById.set(id as Keybinding, keys);
		}
	}

	matches(data: string, keybinding: Keybinding): boolean {
		const keys = this.#keysById.get(keybinding) ?? [];
		for (const key of keys) {
			if (matchesKey(data, key)) return true;
		}

		// Handle shifted symbol keys (e.g., shift+- produces _ on US layout)
		const parsed = parseKey(data);
		if (!parsed?.startsWith("shift+")) return false;
		const keyName = parsed.slice("shift+".length);
		if (!SHIFTED_SYMBOL_KEYS.has(keyName)) return false;
		return keys.includes(keyName as KeyId);
	}

	getKeys(keybinding: Keybinding): KeyId[] {
		return [...(this.#keysById.get(keybinding) ?? [])];
	}

	getDefinition(keybinding: Keybinding): KeybindingDefinition {
		return this.#definitions[keybinding];
	}

	getConflicts(): KeybindingConflict[] {
		return this.#conflicts.map(conflict => ({ ...conflict, keybindings: [...conflict.keybindings] }));
	}

	setUserBindings(userBindings: KeybindingsConfig): void {
		this.#userBindings = userBindings;
		this.#rebuild();
	}

	getUserBindings(): KeybindingsConfig {
		return { ...this.#userBindings };
	}

	getResolvedBindings(): KeybindingsConfig {
		const resolved: KeybindingsConfig = {};
		for (const id of Object.keys(this.#definitions)) {
			const keys = this.#keysById.get(id as Keybinding) ?? [];
			resolved[id] = keys.length === 1 ? keys[0]! : [...keys];
		}
		return resolved;
	}

	/**
	 * Return all bindings (standalone + chord) with their action names, with
	 * user overrides already applied (same rules as getResolvedBindings).
	 */
	getChordBindings(): ChordBinding[] {
		const result: ChordBinding[] = [];
		for (const [action, keys] of this.#keysById) {
			for (const key of keys) {
				const parsed = parseBinding(key);
				if (!parsed.ok) continue;
				result.push({ action, sequence: parsed.sequence });
			}
		}
		return result;
	}

	/**
	 * Return conflicts where a key is used BOTH as a chord leader AND as a
	 * standalone binding for some other action. Consumers (InputController)
	 * should refuse to initialize the dispatcher if any are reported.
	 */
	getChordConflicts(): Array<{
		key: KeyId;
		standaloneActions: string[];
		chordActions: string[];
	}> {
		const standaloneByKey = new Map<KeyId, Set<string>>();
		const leaderByKey = new Map<KeyId, Set<string>>();
		for (const binding of this.getChordBindings()) {
			const [first, second] = binding.sequence;
			if (second === undefined) {
				const set = standaloneByKey.get(first!) ?? new Set<string>();
				set.add(binding.action);
				standaloneByKey.set(first!, set);
			} else {
				const set = leaderByKey.get(first!) ?? new Set<string>();
				set.add(binding.action);
				leaderByKey.set(first!, set);
			}
		}
		const conflicts: Array<{ key: KeyId; standaloneActions: string[]; chordActions: string[] }> = [];
		for (const [key, leaders] of leaderByKey) {
			const standalones = standaloneByKey.get(key);
			if (!standalones || standalones.size === 0) continue;
			conflicts.push({
				key,
				standaloneActions: [...standalones].sort(),
				chordActions: [...leaders].sort(),
			});
		}
		return conflicts;
	}
}

let globalKeybindings: KeybindingsManager | null = null;

export function setKeybindings(keybindings: KeybindingsManager): void {
	globalKeybindings = keybindings;
}

export function getKeybindings(): KeybindingsManager {
	if (!globalKeybindings) {
		globalKeybindings = new KeybindingsManager(TUI_KEYBINDINGS);
	}
	return globalKeybindings;
}
