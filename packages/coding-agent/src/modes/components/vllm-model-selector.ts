import { Container, type SelectItem, SelectList, Spacer, Text } from "@f5-sales-demo/pi-tui";
import type { LoginModelChoice } from "../controllers/login-model";
import { getSelectListTheme } from "../theme/theme";
import { DynamicBorder } from "./dynamic-border";

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
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text("Select your default vLLM model:", 1, 0));
		this.addChild(new Spacer(1));
		this.#selectList = new SelectList(items, items.length, getSelectListTheme());
		this.#selectList.onSelect = item => {
			const choice = choices.find(candidate => candidate.modelId === item.value);
			if (choice) onSelect(choice);
		};
		this.#selectList.onCancel = onCancel;
		this.addChild(this.#selectList);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
	}

	getSelectList(): SelectList {
		return this.#selectList;
	}
}
