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
	onRetry?: (text: string) => void;
	/** Rendered in place of the rows when there are no messages. */
	emptyState?: ReactNode;
	/** Accessible label for the transcript live region (default "Conversation"). */
	label?: string;
}

export function Transcript({ messages, streaming, onRetry, emptyState, label = "Conversation" }: TranscriptProps) {
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

	// After each render, follow the tail only if the user was already at the bottom.
	useLayoutEffect(() => {
		const el = scrollRef.current;
		if (el && userAtBottom.current) el.scrollTop = el.scrollHeight;
	});

	const lastId = messages.length > 0 ? messages[messages.length - 1].id : null;
	const empty = messages.length === 0;

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
				{empty && emptyState ? emptyState : messages.map(m => renderMessage(m, lastId, streaming, onRetry))}
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
): ReactNode {
	if (m.role === "user") return <UserMessage key={m.id} text={m.text} />;
	if (m.role === "tool") return <ToolMessage key={m.id} tool={m.tool ?? "tool"} ok={m.ok ?? true} text={m.text} />;
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
	if (!m.text && streaming) return <ThinkingIndicator key={m.id} />;
	return <AssistantMessage key={m.id} text={m.text} />;
}
