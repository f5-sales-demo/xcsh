import { renderContextMessage } from "../../services/xcsh-table";
import { ContextAddWizard } from "../components/context-add-wizard";
import type { InteractiveModeContext } from "../types";

export class ContextCommandController {
	#ctx: InteractiveModeContext;

	constructor(ctx: InteractiveModeContext) {
		this.#ctx = ctx;
	}

	async handle(command: { name: string; args: string; text: string }): Promise<void> {
		const sub = command.args.trim().split(/\s+/)[0];
		if (sub === "wizard") {
			return this.#handleWizard();
		}
		const { handleContextCommand } = await import("../../services/xcsh-context-command");
		await handleContextCommand(command, this.#ctx);
	}

	async #handleWizard(): Promise<void> {
		const done = () => {
			this.#ctx.editorContainer.clear();
			this.#ctx.editorContainer.addChild(this.#ctx.editor);
			this.#ctx.ui.setFocus(this.#ctx.editor);
		};

		const wizard = new ContextAddWizard(
			async (context, shouldActivate) => {
				done();
				try {
					const { ContextService } = await import("../../services/xcsh-context");
					const service = await ContextService.getOrInit();
					await service.createContext(context);
					if (shouldActivate) {
						await service.activate(context.name);
						this.#ctx.showStatus(renderContextMessage(context.name, "Created and activated."), { dim: false });
					} else {
						this.#ctx.showStatus(renderContextMessage(context.name, "Created."), { dim: false });
					}
					this.#ctx.statusLine?.invalidate();
					this.#ctx.updateEditorTopBorder?.();
					this.#ctx.ui?.requestRender();
				} catch (err) {
					this.#ctx.showError(`Failed to create context: ${err instanceof Error ? err.message : String(err)}`);
				}
			},
			() => {
				done();
			},
			() => {
				this.#ctx.ui.requestRender();
			},
		);

		this.#ctx.editorContainer.clear();
		this.#ctx.editorContainer.addChild(wizard);
		this.#ctx.ui.setFocus(wizard);
		this.#ctx.ui.requestRender();
	}
}
