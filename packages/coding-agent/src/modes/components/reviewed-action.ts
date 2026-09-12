import { isDeepStrictEqual } from "node:util";

/** Internal UI contract; never changes extension callbacks or machine-facing commands. */
export interface ActionReview {
	identity: string;
	scope: string;
	revision: string;
	changes: ReadonlyArray<{ field: string; before: string; after: string }>;
	consequence: string;
}

export class StaleActionReviewError extends Error {
	constructor() {
		super("The target changed or is unavailable. Open the action again to review its current state.");
	}
}

/** Resolve immediately before writing. Never execute a changed or missing proposal. */
export async function executeReviewedAction<T>(
	review: ActionReview,
	resolve: () => Promise<{ review: ActionReview; target: T } | undefined>,
	execute: (target: T) => Promise<void>,
): Promise<void> {
	const current = await resolve();
	if (!current || !isDeepStrictEqual(review, current.review)) throw new StaleActionReviewError();
	await execute(current.target);
}
