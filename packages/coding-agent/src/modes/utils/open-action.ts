import { createHash } from "node:crypto";
import type { OpenHttpUrlResult, OpenPathResult } from "../../utils/open";
import type { ActionReview } from "../components/reviewed-action";
import { type ReviewedActionOutcome, runReviewedAction } from "../components/reviewed-action-dialog";
import type { InteractiveModeContext } from "../types";

interface ReviewExternalUrlOptions {
	title: string;
	identity: string;
	scope: string;
	current(): boolean;
	resolveUrl(): string | undefined;
	open(url: string): Promise<OpenHttpUrlResult>;
}

interface ReviewLocalPathOptions {
	title: string;
	identity: string;
	scope: string;
	current(): boolean;
	resolvePath(): Promise<{ path: string; revision: string; description: string } | undefined>;
	open(path: string): Promise<OpenPathResult>;
}

/** Review and revalidate a local application/file-manager launch. */
export async function reviewLocalPathAction(
	ctx: InteractiveModeContext,
	options: ReviewLocalPathOptions,
): Promise<ReviewedActionOutcome | "busy" | "missing"> {
	const resolve = async () => {
		if (!options.current()) return undefined;
		const value = await options.resolvePath();
		if (!value) return undefined;
		const review: ActionReview = {
			identity: options.identity,
			scope: options.scope,
			revision: value.revision,
			changes: [
				{ field: "Local target", before: "Not opened", after: value.path },
				{ field: "Resolved object", before: "Not accessed", after: value.description },
			],
			consequence:
				"Launches the exact local target in the configured file manager or application. The application may record the path in recent-item history; no remote publication is requested.",
		};
		return { review, target: value.path };
	};
	const proposal = await resolve();
	if (!proposal) return "missing";
	return runReviewedAction(ctx, options.title, {
		review: proposal.review,
		resolve,
		cancellable: false,
		execute: async target => {
			const result = await options.open(target);
			if (!result.ok) throw new Error(`Could not open local target: ${result.error}`);
		},
	});
}

export async function reviewExternalUrlAction(
	ctx: InteractiveModeContext,
	options: ReviewExternalUrlOptions,
): Promise<ReviewedActionOutcome | "busy" | "missing"> {
	const resolve = async () => {
		if (!options.current()) return undefined;
		const value = options.resolveUrl();
		if (!value) return undefined;
		const url = new URL(value);
		if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
		const normalized = url.toString();
		const revision = createHash("sha256").update(normalized).digest("hex");
		const review: ActionReview = {
			identity: options.identity,
			scope: options.scope,
			revision,
			changes: [
				{ field: "Destination", before: "No browser navigation", after: normalized },
				{ field: "Remote origin", before: "Not contacted", after: url.origin },
			],
			consequence:
				"Launches the URL in the configured local browser. The destination may receive network metadata, browser cookies, and account state; xcsh does not upload the conversation.",
		};
		return { review, target: normalized };
	};
	const proposal = await resolve();
	if (!proposal) return "missing";
	return runReviewedAction(ctx, options.title, {
		review: proposal.review,
		resolve,
		cancellable: false,
		execute: async url => {
			const result = await options.open(url);
			if (!result.ok) throw new Error(`Could not open link: ${result.error}`);
		},
	});
}
