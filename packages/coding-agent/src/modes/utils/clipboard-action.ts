import { createHash } from "node:crypto";
import { copyToClipboardWithDelivery } from "../../utils/clipboard";
import type { ActionReview } from "../components/reviewed-action";
import { runReviewedAction } from "../components/reviewed-action-dialog";
import type { InteractiveModeContext } from "../types";

export interface ClipboardAction {
	title: string;
	identity: string;
	label: string;
	success: string;
	reopen: string;
	current(): boolean;
	resolveText(): string | undefined;
}

const activeCopies = new WeakSet<InteractiveModeContext>();

/** Internal adapter shared by typed commands and selectors; never reads the old clipboard. */
export async function reviewClipboardAction(ctx: InteractiveModeContext, action: ClipboardAction) {
	if (activeCopies.has(ctx)) {
		ctx.showWarning("A clipboard copy is already open or running.");
		return "busy" as const;
	}
	activeCopies.add(ctx);
	try {
		const prepare = () => {
			if (!action.current()) return undefined;
			const text = action.resolveText();
			if (!text) return undefined;
			const review: ActionReview = {
				identity: action.identity,
				scope: `System clipboard · ${action.label}`,
				revision: createHash("sha256").update(text).digest("hex"),
				changes: [
					{
						field: "Clipboard text",
						before: "Existing contents (not read)",
						after: `${action.label} · ${Buffer.byteLength(text, "utf8")} UTF-8 bytes`,
					},
				],
				consequence:
					"Replaces clipboard text. Sends the selected text to the local clipboard and, when supported, the connected terminal clipboard. Other applications or clipboard-history services may read or retain it. No public publication is requested." +
					(process.platform === "linux"
						? "\nLinux: clipboard text may disappear after xcsh exits unless a clipboard manager retains it."
						: ""),
			};
			return { review, target: text };
		};
		const proposal = prepare();
		if (!proposal) {
			ctx.showWarning(`No current text is available to copy. ${action.reopen}`);
			return "empty" as const;
		}
		let delivery: "copied" | "requested" | undefined;
		const outcome = await runReviewedAction(ctx, action.title, {
			review: proposal.review,
			resolve: async () => prepare(),
			execute: async text => {
				if (!action.current()) throw new Error(`The copy target changed. ${action.reopen}`);
				const result = await copyToClipboardWithDelivery(text);
				if (!result.ok) throw new Error(`Clipboard unavailable: ${result.error}`);
				delivery = result.delivery;
			},
		});
		if (outcome === "succeeded") {
			if (delivery === "copied") ctx.showStatus(action.success);
			else ctx.showWarning("Clipboard request sent to the terminal; delivery cannot be verified.");
			return delivery!;
		}
		if (outcome === "unresolved") ctx.showError(`Clipboard delivery remains unresolved. ${action.reopen}`);
		return outcome;
	} catch (error) {
		ctx.showError(`Clipboard copy failed: ${error instanceof Error ? error.message : String(error)}`);
		return "unresolved" as const;
	} finally {
		activeCopies.delete(ctx);
	}
}
