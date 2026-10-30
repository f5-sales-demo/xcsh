/**
 * Rich tool-use block: a tool name summary + collapsible IN/OUT panels with a
 * copy affordance. Promoted from the VS Code webview, headless (no i18n; labels
 * are plain strings). `navigator.clipboard` is a browser standard — no host global.
 */
import { useState } from "react";
import { AnswerRecapView } from "../interactions/AnswerRecapView";
import { questionToolRecap } from "../interactions/answer-recap";
import type { ToolUseBlock } from "../types";
import { CodePanel } from "./CodePanel";

export interface ToolUseContentProps {
	block: ToolUseBlock;
}

export function ToolUseContent({ block }: ToolUseContentProps) {
	const [copied, setCopied] = useState(false);
	let args: unknown;
	try {
		args = block.input ? JSON.parse(block.input) : undefined;
	} catch {
		/* Incomplete streamed input. */
	}
	const question = questionToolRecap(block.toolName, args, block.output ?? "", block.running, block.ok);

	function handleCopy(text: string) {
		void navigator.clipboard.writeText(text).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		});
	}

	if (question) return <AnswerRecapView recap={question.recap} evidence={question.evidence} />;
	return (
		<div className="tool-use">
			<div className="tool-summary">
				<span className="tool-name">{block.toolName}</span>
				{block.running && <span className="tool-running">…</span>}
			</div>
			<div className="tool-body">
				{block.input && (
					<div className="tool-row">
						<div className="tool-row-label">IN</div>
						<div className="tool-row-content">
							<CodePanel source={block.input} complete={!block.running} />
						</div>
						<button className="tool-copy-btn" type="button" onClick={() => handleCopy(block.input ?? "")}>
							{copied ? "Copied" : "Copy"}
						</button>
					</div>
				)}
				{block.output && (
					<div className="tool-row">
						<div className="tool-row-label">OUT</div>
						<div className="tool-row-content">
							<CodePanel source={block.output} complete={!block.running} />
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
