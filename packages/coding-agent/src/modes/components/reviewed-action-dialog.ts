import { Container, getKeybindings, wrapTextWithAnsi } from "@f5-sales-demo/pi-tui";
import { formatKeyHints } from "../../config/keybindings";
import { theme } from "../theme/theme";
import type { InteractiveModeContext } from "../types";
import { matchesAppInterrupt } from "../utils/keybinding-matchers";
import { type ActionReview, executeReviewedAction, StaleActionReviewError } from "./reviewed-action";
import {
	matchesSelectorKey,
	selectorCancelHint,
	selectorFrame,
	selectorFrameContentWidth,
	selectorKeys,
	selectorNavigationHint,
	selectorRow,
} from "./selector-frame";

export interface ReviewedAction<T> {
	review: ActionReview;
	resolve(): Promise<{ review: ActionReview; target: T } | undefined>;
	execute(target: T, signal: AbortSignal): Promise<void>;
	cancellable?: boolean;
}

/** An adapter throws this only after it has stopped and accounted for its partial effects. */
export class ActionInterruptedError extends Error {}
export type ReviewedActionOutcome = "cancelled" | "succeeded" | "unresolved" | "interrupted";

export class ReviewedActionDialog<T> extends Container {
	#review: ActionReview;
	#selected = 0;
	#offset = 0;
	#running = false;
	#closed = false;
	#executed = false;
	#abort: AbortController | undefined;
	#error = "";
	#errorTone: "warning" | "error" = "error";
	constructor(
		private readonly title: string,
		private readonly action: ReviewedAction<T>,
		private readonly done: (outcome: ReviewedActionOutcome) => void,
		private readonly refresh: () => void = () => {},
		private readonly rows: () => number = () => process.stdout.rows || 24,
	) {
		super();
		this.#review = structuredClone(action.review);
	}
	override render(width: number): string[] {
		const inner = selectorFrameContentWidth(width);
		const details = [
			this.#error ? theme.fg(this.#errorTone, this.#error) : "",
			`Target: ${this.#review.identity}`,
			...this.#review.changes.map(change => `${change.field}: ${change.before} → ${change.after}`),
			this.#review.consequence,
		].flatMap(line => (line ? wrapTextWithAnsi(line, inner) : []));
		const capacity = Math.max(1, this.rows() - 12);
		const keys = getKeybindings();
		const interruptHint = keys.getDefinition("app.interrupt")
			? formatKeyHints(keys.getKeys("app.interrupt"))
			: "Ctrl+C";
		this.#offset = Math.min(this.#offset, Math.max(0, details.length - capacity));
		return selectorFrame(
			width,
			this.rows(),
			`${this.#running ? "Applying" : this.#executed ? "Unresolved" : "Review"} ${this.title}`,
			this.#review.scope,
			[],
			this.#running
				? [
						this.#abort?.signal.aborted
							? "Interruption requested; waiting for acknowledgement…"
							: "Operation in progress…",
					]
				: [
						this.#executed ? "Close unresolved result" : "Cancel",
						this.#executed ? "Retry change" : "Confirm change",
					].map((label, index) => selectorRow([label], [inner - 2], index === this.#selected)),
			details.slice(this.#offset, this.#offset + capacity),
			[
				...(details.length > capacity
					? [`${selectorKeys("pageUp")}/${selectorKeys("pageDown")}: review details`]
					: []),
				...(this.#running
					? [
							this.action.cancellable && interruptHint
								? `${interruptHint}: request interruption`
								: "This operation cannot be interrupted; waiting for its result.",
						]
					: [
							selectorNavigationHint("confirm"),
							selectorCancelHint(this.#executed ? "close unresolved result" : "cancel"),
						]),
			],
			{ selectedBodyIndex: this.#selected },
		);
	}
	async #execute(): Promise<void> {
		if (this.#running || this.#closed) return;
		this.#running = true;
		this.#abort = new AbortController();
		this.#error = "";
		this.refresh();
		let resolved: { review: ActionReview; target: T } | undefined;
		try {
			await executeReviewedAction(
				this.#review,
				async () => {
					resolved = await this.action.resolve();
					return resolved;
				},
				target => {
					if (this.#abort!.signal.aborted) throw new ActionInterruptedError("Stopped before execution.");
					this.#executed = true;
					return this.action.execute(target, this.#abort!.signal);
				},
			);
			this.#closed = true;
			this.done("succeeded");
		} catch (error) {
			if (this.#abort.signal.aborted && error instanceof ActionInterruptedError) {
				this.#closed = true;
				this.done("interrupted");
				return;
			}
			this.#error = error instanceof Error ? error.message : String(error);
			// Revalidation prevented execution; it is not a failed backing operation.
			this.#errorTone = error instanceof StaleActionReviewError ? "warning" : "error";
			if (
				error instanceof StaleActionReviewError &&
				resolved?.review.identity === this.#review.identity &&
				resolved.review.scope === this.#review.scope
			) {
				this.#review = structuredClone(resolved.review);
				this.#error = "The proposal changed. Review the updated values before confirming.";
			}
			this.#selected = 0;
			this.#offset = 0;
		} finally {
			this.#running = false;
			this.refresh();
		}
	}
	handleInput(data: string): void {
		if (this.#closed) return;
		if (matchesSelectorKey(data, "pageDown")) {
			this.#offset += 3;
			return;
		}
		if (matchesSelectorKey(data, "pageUp")) {
			this.#offset = Math.max(0, this.#offset - 3);
			return;
		}
		if (this.#running) {
			if (this.action.cancellable && matchesAppInterrupt(data)) {
				this.#abort?.abort();
				this.refresh();
			}
			return;
		}
		if (matchesSelectorKey(data, "cancel") || (matchesSelectorKey(data, "confirm") && this.#selected === 0)) {
			this.#closed = true;
			this.done(this.#executed ? "unresolved" : "cancelled");
		} else if (matchesSelectorKey(data, "up") || matchesSelectorKey(data, "down"))
			this.#selected = 1 - this.#selected;
		else if (matchesSelectorKey(data, "confirm")) void this.#execute();
	}
}

const activeReviews = new WeakSet<InteractiveModeContext>();
export async function runReviewedAction<T>(
	ctx: InteractiveModeContext,
	title: string,
	action: ReviewedAction<T>,
): Promise<ReviewedActionOutcome | "busy"> {
	if (activeReviews.has(ctx)) return "busy";
	activeReviews.add(ctx);
	try {
		return await ctx.showHookCustom<ReviewedActionOutcome>(
			(ui, _theme, _keys, done) =>
				new ReviewedActionDialog(
					title,
					action,
					done,
					() => ui.requestRender(),
					() => ui.terminal.rows,
				),
			{ overlay: true, fullscreen: true },
		);
	} finally {
		activeReviews.delete(ctx);
	}
}
