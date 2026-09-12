import { Container, type SelectItem, type SelectList } from "@f5-sales-demo/pi-tui";
import type { LiteLLMLoginModelChoice } from "../controllers/login-model";
import { getSelectListTheme } from "../theme/theme";
import { SearchableSelectList } from "./searchable-select-list";

export class LiteLLMModelSelectorComponent extends Container {
	#selectList: SelectList;

	constructor(
		choices: readonly LiteLLMLoginModelChoice[],
		onSelect: (choice: LiteLLMLoginModelChoice) => void,
		onCancel: () => void,
	) {
		super();

		const items: SelectItem[] = choices.map(choice => ({
			value: `${choice.provider}/${choice.modelId}`,
			label: choice.label,
			description: choice.description,
		}));

		this.#selectList = new SearchableSelectList(
			"Choose default LiteLLM model",
			"Select the provider-qualified model to use after the reviewed connection is saved.",
			items,
			items.length,
			getSelectListTheme(),
		);
		this.#selectList.onSelect = item => {
			const choice = choices.find(candidate => `${candidate.provider}/${candidate.modelId}` === item.value);
			if (choice) onSelect(choice);
		};
		this.#selectList.onCancel = onCancel;
		this.addChild(this.#selectList);
	}

	getSelectList(): SelectList {
		return this.#selectList;
	}
}
