import { Text } from "@f5-sales-demo/pi-tui";
import { renderOutputBlock, renderStatusLine } from "../../tui";
import type { State } from "../../tui/types";
import { theme } from "../theme/theme";
import { PluginViewComponent } from "./plugin-view";

/** Text-compatible status replacement retains existing progress coalescing. */
export class PluginLifecycleText extends Text {
	constructor(
		private message: string,
		private state?: State,
	) {
		super(message, 0, 0);
	}
	override setText(message: string): void {
		this.message = message;
		super.setText(message);
	}
	override render(width: number): string[] {
		const view = new PluginViewComponent(() => ({ sections: [{ kind: "code", text: this.message }] }), true);
		return renderOutputBlock(
			{
				header: renderStatusLine({ title: this.state === "error" ? "Plugin error" : "Plugins" }, theme),
				state: this.state,
				width,
				sections: [{ lines: view.render(Math.max(1, width - 3)) }],
			},
			theme,
		);
	}
}
