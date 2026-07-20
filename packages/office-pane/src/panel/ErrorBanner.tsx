/**
 * ErrorBanner — shown when session status is 'error'.
 *
 * Maps every ChatErrorReason to a human-readable message via an exhaustive
 * Record<ChatErrorReason, string>. TypeScript enforces completeness at
 * compile time: adding a new reason to CHAT_ERROR_REASONS without updating
 * ERROR_MESSAGES here will cause a type error.
 *
 * Browser-safe: no node:* imports, no Office.js.
 */
import { Button } from "@fluentui/react-components";

import type { ChatErrorReason } from "../core";

/**
 * Exhaustive human-readable message for every ChatErrorReason.
 * The Record<ChatErrorReason, string> type guarantees all reasons are covered.
 */
export const ERROR_MESSAGES: Record<ChatErrorReason, string> = {
	"bridge-disconnected": "Connection to the assistant was lost.",
	"bridge-unresponsive": "The assistant stopped responding.",
	"no-worker": "No assistant worker is running for this tab.",
	"session-busy": "A request is already in progress — please wait and retry.",
	"session-disposed": "The assistant session was closed.",
	"token-expired": "Your session token has expired. Please sign in again.",
	"token-expiring": "Your session token is about to expire.",
	"provider-4xx": "The request was rejected by the upstream service.",
	"provider-5xx": "The upstream service encountered an error.",
};

/** Shown when an error has no classified reason and no raw text is available. */
export const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export interface ErrorBannerProps {
	/** Classified reason; when present, its mapped message is shown. */
	reason?: ChatErrorReason;
	/** Raw error text, shown when `reason` is absent (unclassified error). */
	error?: string;
	onRetry: () => void;
}

/**
 * Renders the best available message: a mapped message for a classified
 * `reason`, else the raw `error` text, else a generic fallback — always with a
 * Retry. This guarantees an errored session never renders a silent, empty state.
 */
export function ErrorBanner({ reason, error, onRetry }: ErrorBannerProps) {
	const message = reason !== undefined ? ERROR_MESSAGES[reason] : error?.trim() || GENERIC_ERROR_MESSAGE;
	return (
		<div role="alert">
			<span>{message}</span>
			<Button onClick={onRetry}>Retry</Button>
		</div>
	);
}
