/**
 * The scrolling message transcript. Renders each {@link ChatMessage} through the
 * gutter-grid renderers and keeps the view pinned to the bottom while the user
 * is already at the bottom (the VS Code "at-bottom" math: within 50px). When the
 * user scrolls up, a scroll-to-bottom FAB appears (a NEW affordance unifying the
 * Chrome auto-scroll with a VS Code-style jump control).
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage, ReactNode } from "../types";
import { AssistantMessage, ErrorMessage, ThinkingIndicator, ToolMessage, UserMessage } from "./messages";

const AT_BOTTOM_SLOP = 50;

export interface TranscriptProps {
	messages: ChatMessage[];
	streaming: boolean;
	/**
	 * Suffix for the pre-first-token "Thinking…" row, so a turn that will take
	 * noticeably longer says why (e.g. "with web search" — a server-side search adds
	 * several seconds before any token, which otherwise reads as a hang).
	 */
	thinkingLabel?: string;
	onRetry?: (text: string) => void;
	/**
	 * Rendered as the FIRST child INSIDE the scrollport, in both the empty and the
	 * populated state — so a host brand block (logo + wordmark) is visible on open
	 * and then scrolls away with the conversation (Claude-for-Office behaviour).
	 *
	 * It must live inside `.messages` rather than in {@link emptyState}: the empty
	 * state unmounts on the first send, so brand-via-emptyState would VANISH
	 * instead of scrolling. Static content, so being inside the `aria-live` log is
	 * harmless (initial content is not announced and it never mutates).
	 */
	brand?: ReactNode;
	/** Rendered in place of the rows when there are no messages. */
	emptyState?: ReactNode;
	/** Accessible label for the transcript live region (default "Conversation"). */
	label?: string;
}

export function Transcript({
	messages,
	streaming,
	thinkingLabel,
	onRetry,
	brand,
	emptyState,
	label = "Conversation",
}: TranscriptProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const userAtBottom = useRef(true);
	const [showFab, setShowFab] = useState(false);

	const computeAtBottom = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return true;
		return el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_SLOP;
	}, []);

	const handleScroll = useCallback(() => {
		const atBottom = computeAtBottom();
		userAtBottom.current = atBottom;
		setShowFab(!atBottom);
	}, [computeAtBottom]);

	const scrollToBottom = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		el.scrollTop = el.scrollHeight;
		userAtBottom.current = true;
		setShowFab(false);
	}, []);

	const lastId = messages.length > 0 ? messages[messages.length - 1].id : null;
	const empty = messages.length === 0;

	// After each render, follow the tail only if the user was already at the bottom.
	// NOT while empty: `userAtBottom` starts true and this effect has no dep array, so
	// an empty transcript would be pinned to the bottom on first paint — scrolling the
	// `brand` block out of view before the user ever sees it.
	useLayoutEffect(() => {
		const el = scrollRef.current;
		if (el && userAtBottom.current && !empty) el.scrollTop = el.scrollHeight;
	});

	return (
		<>
			<div
				className="messages"
				ref={scrollRef}
				onScroll={handleScroll}
				role="log"
				aria-live="polite"
				aria-label={label}
			>
				{brand}
				{empty && emptyState
					? emptyState
					: messages.map(m => renderMessage(m, lastId, streaming, onRetry, thinkingLabel))}
			</div>
			{showFab && (
				<button
					type="button"
					className="scroll-to-bottom"
					title="Scroll to bottom"
					aria-label="Scroll to bottom"
					onClick={scrollToBottom}
				>
					↓
				</button>
			)}
		</>
	);
}

function renderMessage(
	m: ChatMessage,
	lastId: string | null,
	streaming: boolean,
	onRetry?: (text: string) => void,
	thinkingLabel?: string,
): ReactNode {
	if (m.role === "user") return <UserMessage key={m.id} text={m.text} />;
	if (m.role === "tool")
		return <ToolMessage key={m.id} tool={m.tool ?? "tool"} ok={m.ok ?? true} text={m.text} running={m.running} />;
	if (m.error) {
		const canRetry = !!m.retryText && m.id === lastId && !!onRetry;
		return (
			<ErrorMessage
				key={m.id}
				text={m.text || "Turn aborted."}
				onRetry={canRetry ? () => onRetry?.(m.retryText as string) : undefined}
			/>
		);
	}
	if (!m.text && streaming) return <ThinkingIndicator key={m.id} label={thinkingLabel} />;
	// The caret marks the live turn — only the last row while the session streams.
	return (
		<AssistantMessage
			key={m.id}
			text={m.text}
			references={m.references}
			media={m.media}
			streaming={streaming && m.id === lastId}
		/>
	);
}
