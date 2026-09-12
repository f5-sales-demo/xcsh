import { Container, type SelectItem, type SelectList } from "@f5-sales-demo/pi-tui";
import { getSelectListTheme } from "../../modes/theme/theme";
import { SearchableSelectList } from "./searchable-select-list";

/**
 * Component that renders a queue mode selector with borders
 */
export class QueueModeSelectorComponent extends Container {
	#selectList: SelectList;

	constructor(
		currentMode: "all" | "one-at-a-time",
		onSelect: (mode: "all" | "one-at-a-time") => void,
		onCancel: () => void,
	) {
		super();

		const queueModes: SelectItem[] = [
			{
				value: "one-at-a-time",
				label: "one-at-a-time",
				description: "Process queued messages one by one (recommended)",
			},
			{ value: "all", label: "all", description: "Process all queued messages at once" },
		];

		this.#selectList = new SearchableSelectList(
			"Choose queue mode",
			"Choose how queued prompts are delivered to the active session.",
			queueModes,
			2,
			getSelectListTheme(),
		);

		// Preselect current mode
		const currentIndex = queueModes.findIndex(item => item.value === currentMode);
		if (currentIndex !== -1) {
			this.#selectList.setSelectedIndex(currentIndex);
		}

		this.#selectList.onSelect = item => {
			onSelect(item.value as "all" | "one-at-a-time");
		};

		this.#selectList.onCancel = () => {
			onCancel();
		};

		this.addChild(this.#selectList);
	}

	getSelectList(): SelectList {
		return this.#selectList;
	}
}
