import { ContextAddWizard } from "../components/context-add-wizard";
import type { InteractiveModeContext } from "../types";

export class ContextCommandController {
	#ctx: InteractiveModeContext;

	constructor(ctx: InteractiveModeContext) {
		this.#ctx = ctx;
	}

	async handle(text: string): Promise<void> {
		const sub = text.trim().split(/\s+/).slice(1)[0];
		if (sub === "wizard") {
			return this.#handleWizard();
		}
		const { handleContextCommand } = await import("../../services/f5xc-context-command");
		await handleContextCommand({ name: "context", args: text.replace(/^\/context\s*/, ""), text }, this.#ctx);
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
					const { ContextService } = await import("../../services/f5xc-context");
					const service = await ContextService.getOrInit();
					await service.createContext(context.name, context.apiUrl, context.apiToken, context.defaultNamespace);
					this.#ctx.showStatus(`Context '${context.name}' created.`);
					if (shouldActivate) {
						await service.activate(context.name);
						this.#ctx.showStatus(`Context '${context.name}' activated.`);
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
