/**
 * Dispatches a single assistant `ContentBlock` to its renderer. `tool_use`
 * blocks render nothing here (hosts surface tool activity via the transcript's
 * ToolMessage / a dedicated ToolUseContent panel); text → markdown; thinking →
 * the collapsible disclosure.
 */

import { AnswerRecapView } from "../interactions/AnswerRecapView";
import { questionToolRecap } from "../interactions/answer-recap";
import type { ContentBlock } from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ThinkingBlock } from "./ThinkingBlock";

export interface ContentBlockRendererProps {
	block: ContentBlock;
	isLast: boolean;
	busy: boolean;
}

export function ContentBlockRenderer({ block, isLast, busy }: ContentBlockRendererProps) {
	switch (block.type) {
		case "text":
			return <MarkdownRenderer className="body markdown-root" text={block.text} />;
		case "tool_use": {
			let args: unknown;
			try {
				args = block.input ? JSON.parse(block.input) : undefined;
			} catch {
				/* Incomplete streamed input. */
			}
			const question = questionToolRecap(block.toolName, args, block.output ?? "", block.running, block.ok);
			return question ? <AnswerRecapView recap={question.recap} evidence={question.evidence} /> : null;
		}
		case "thinking":
			return (
				<ThinkingBlock
					thinking={block.thinking}
					isCurrentlyThinking={isLast && busy && !block.thinking}
					durationMs={block.durationMs}
				/>
			);
		default:
			return null;
	}
}
