import { Container, type SelectItem, type SelectList } from "@f5-sales-demo/pi-tui";
import type { LoginModelChoice } from "../controllers/login-model";
import { getSelectListTheme } from "../theme/theme";
import { SearchableSelectList } from "./searchable-select-list";

export class VllmModelSelectorComponent extends Container {
	#selectList: SelectList;

	constructor(
		choices: readonly LoginModelChoice[],
		onSelect: (choice: LoginModelChoice) => void,
		onCancel: () => void,
	) {
		super();
		const items: SelectItem[] = choices.map(choice => ({
			value: choice.modelId,
			label: choice.label,
			description: choice.description,
		}));
		this.#selectList = new SearchableSelectList(
			"Choose default vLLM model",
			"Select the model to use after the reviewed connection is saved.",
			items,
			items.length,
			getSelectListTheme(),
		);
		this.#selectList.onSelect = item => {
			const choice = choices.find(candidate => candidate.modelId === item.value);
			if (choice) onSelect(choice);
		};
		this.#selectList.onCancel = onCancel;
		this.addChild(this.#selectList);
	}

	getSelectList(): SelectList {
		return this.#selectList;
	}
}
