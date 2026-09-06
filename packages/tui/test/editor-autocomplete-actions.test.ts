import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	type AutocompleteItem,
	type AutocompleteProvider,
	CombinedAutocompleteProvider,
} from "@f5-sales-demo/pi-tui/autocomplete";
import { Editor } from "@f5-sales-demo/pi-tui/components/editor";
import { defaultEditorTheme } from "./test-themes";

function onceAutocompleteUpdate(editor: Editor): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	const previous = editor.onAutocompleteUpdate;
	editor.onAutocompleteUpdate = () => {
		editor.onAutocompleteUpdate = previous;
		previous?.();
		resolve();
	};
	return promise;
}

async function untilAutocompleteShown(editor: Editor): Promise<void> {
	while (!editor.isShowingAutocomplete()) {
		await onceAutocompleteUpdate(editor);
	}
}

async function requireAutocompleteShown(editor: Editor): Promise<void> {
	await Promise.race([
		untilAutocompleteShown(editor),
		Bun.sleep(250).then(() => Promise.reject(new Error("autocomplete did not reopen"))),
	]);
}

class HashActionProvider implements AutocompleteProvider {
	async getSuggestions(
		lines: string[],
		_cursorLine: number,
		cursorCol: number,
	): Promise<{ items: AutocompleteItem[]; prefix: string } | null> {
		const prefix = (lines[0] || "").slice(0, cursorCol);
		if (prefix !== "#") {
			return null;
		}

		return {
			prefix,
			items: [{ value: "action", label: "Do action" }],
		};
	}

	applyCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		_item: AutocompleteItem,
		prefix: string,
	): { lines: string[]; cursorLine: number; cursorCol: number; onApplied?: () => void } {
		const line = lines[cursorLine] || "";
		return {
			lines: [line.slice(0, cursorCol - prefix.length) + line.slice(cursorCol)],
			cursorLine,
			cursorCol: cursorCol - prefix.length,
			onApplied: () => {
				this.calls += 1;
			},
		};
	}

	calls = 0;
}

describe("Editor hash autocomplete actions", () => {
	it("auto-triggers # suggestions and runs autocomplete callbacks on selection", async () => {
		const provider = new HashActionProvider();
		const editor = new Editor(defaultEditorTheme);
		editor.setAutocompleteProvider(provider);

		editor.handleInput("#");
		await Bun.sleep(0);
		editor.handleInput("\r");

		expect(editor.getText()).toBe("");
		expect(provider.calls).toBe(1);
	});
});

describe("Editor directory autocomplete acceptance", () => {
	it.each(["\t", "\r"])("keeps autocomplete open after accepting an @ directory with %j", async key => {
		const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "editor-at-directory-"));
		try {
			fs.mkdirSync(path.join(baseDir, "packages", "tui"), { recursive: true });
			fs.mkdirSync(path.join(baseDir, "packets", "wire"), { recursive: true });
			const editor = new Editor(defaultEditorTheme);
			editor.setAutocompleteProvider(new CombinedAutocompleteProvider([], baseDir));
			let submitted = "";
			editor.onSubmit = text => {
				submitted = text;
			};
			editor.setText("@pack");

			const autocompleteOpened = untilAutocompleteShown(editor);
			editor.handleInput("\t");
			await autocompleteOpened;
			editor.handleInput(key);
			await requireAutocompleteShown(editor);

			expect(editor.getText()).toMatch(/^@pack[^ ]+\/$/);
			expect(editor.isShowingAutocomplete()).toBe(true);
			expect(submitted).toBe("");
		} finally {
			fs.rmSync(baseDir, { recursive: true, force: true });
		}
	});
});
