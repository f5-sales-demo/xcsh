import type { AgentToolContext, ToolCallContext } from "@f5-sales-demo/pi-agent-core";
import type { CustomToolContext } from "../extensibility/custom-tools/types";
import type { ExtensionUIContext } from "../extensibility/extensions/types";

import { withToolInteraction } from "../session/user-interactions";

declare module "@f5-sales-demo/pi-agent-core" {
	interface AgentToolContext extends CustomToolContext {
		ui?: ExtensionUIContext;
		hasUI?: boolean;
		toolNames?: string[];
		toolCall?: ToolCallContext;
	}
}

export class ToolContextStore {
	#uiContext: ExtensionUIContext | undefined;
	#hasUI = false;
	#toolNames: string[] = [];

	constructor(private readonly getBaseContext: () => CustomToolContext) {}

	getContext(toolCall?: ToolCallContext): AgentToolContext {
		const toolCallId = toolCall?.toolCalls[toolCall.index]?.id;
		const original = this.#uiContext;
		const ui =
			original && toolCallId
				? {
						...original,
						select: (...args: Parameters<ExtensionUIContext["select"]>) =>
							withToolInteraction(toolCallId, () => original.select(...args)),
						input: (...args: Parameters<ExtensionUIContext["input"]>) =>
							withToolInteraction(toolCallId, () => original.input(...args)),
						editor: (...args: Parameters<ExtensionUIContext["editor"]>) =>
							withToolInteraction(toolCallId, () => original.editor(...args)),
						confirm: (...args: Parameters<ExtensionUIContext["confirm"]>) =>
							withToolInteraction(toolCallId, () => original.confirm(...args)),
					}
				: original;
		return {
			...this.getBaseContext(),
			ui,
			hasUI: this.#hasUI,
			toolNames: this.#toolNames,
			toolCall,
		};
	}

	setUIContext(uiContext: ExtensionUIContext, hasUI: boolean): void {
		this.#uiContext = uiContext;
		this.#hasUI = hasUI;
	}

	setToolNames(names: string[]): void {
		this.#toolNames = names;
	}
}
