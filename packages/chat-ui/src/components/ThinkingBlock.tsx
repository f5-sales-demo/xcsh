/**
 * Collapsible "thinking" disclosure, promoted from the VS Code webview and made
 * headless (no i18n). Shows a live "Thinking…" label while streaming, then a
 * "Thought for Ns" summary; the body (rendered markdown) expands on toggle.
 */
import { useState } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";

export interface ThinkingBlockProps {
	thinking: string;
	isCurrentlyThinking: boolean;
	durationMs?: number;
}

export function ThinkingBlock({ thinking, isCurrentlyThinking, durationMs }: ThinkingBlockProps) {
	const [isOpen, setIsOpen] = useState(false);
	const hasContent = thinking.length > 0;

	const durationText = durationMs
		? `Thought for ${(durationMs / 1000).toFixed(0)}s`
		: isCurrentlyThinking
			? "Thinking…"
			: "Thinking";

	return (
		<details
			className="thinking-block"
			open={isOpen}
			onToggle={e => setIsOpen((e.target as HTMLDetailsElement).open)}
		>
			<summary className="thinking-summary">
				<span className={`thinking-toggle ${isOpen ? "open" : ""}`}>
					<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
						<path d="M6 4l4 4-4 4" />
					</svg>
				</span>
				<span>{durationText}</span>
			</summary>
			{hasContent && (
				<div className="thinking-content">
					<MarkdownRenderer text={thinking} />
				</div>
			)}
		</details>
	);
}
