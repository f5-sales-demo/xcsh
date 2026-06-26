/**
 * Component for displaying user-initiated Python execution with streaming output.
 * Shares the same kernel session as the agent's Python tool.
 */

import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { Container, Loader, Spacer, Text, type TUI } from "@f5-sales-demo/pi-tui";
import { getSymbolTheme, highlightCode, theme } from "../../modes/theme/theme";
import { formatTruncationMetaNotice, type TruncationMeta } from "../../tools/output-meta";
import { sanitizeErrorMessage } from "../utils/sanitize-error-message";
import { DynamicBorder } from "./dynamic-border";
import { truncateToVisualLines } from "./visual-truncate";

const PREVIEW_LINES = 20;
const MAX_DISPLAY_LINE_CHARS = 4000;

/** Max bytes to attempt JSON detection on */
const JSON_DETECT_LIMIT = 32_768;

/**
 * Detect if output looks like JSON and return syntax-highlighted lines.
 */
function highlightIfStructured(lines: string[]): string[] | undefined {
	if (lines.length === 0) return undefined;
	const firstNonEmpty = lines.find(l => l.trim().length > 0)?.trim();
	if (!firstNonEmpty) return undefined;
	if (firstNonEmpty[0] !== "{" && firstNonEmpty[0] !== "[") return undefined;
	const fullText = lines.join("\n");
	if (fullText.length > JSON_DETECT_LIMIT) return undefined;
	try {
		JSON.parse(fullText);
		return highlightCode(fullText, "json");
	} catch {
		return undefined;
	}
}

export class PythonExecutionComponent extends Container {
	#outputLines: string[] = [];
	// Failure-mode taxonomy:
	//   "complete"  — zero exit
	//   "error"     — non-zero exit (interpreter reported failure)
	//   "cancelled" — user cancelled
	//   "errored"   — uncaught exception (executor threw; no exit code)
	#status: "running" | "complete" | "cancelled" | "error" | "errored" = "running";
	#exitCode: number | undefined = undefined;
	#errorMessage: string | undefined = undefined;
	#loader: Loader;
	#truncation?: TruncationMeta;
	#expanded = false;
	#contentContainer: Container;

	#formatHeader(colorKey: "dim" | "pythonMode"): Text {
		const prompt = theme.fg(colorKey, theme.bold(">>>"));
		const continuation = theme.fg(colorKey, "    ");
		const codeLines = highlightCode(this.code, "python");
		const headerLines = codeLines.map((line, index) =>
			index === 0 ? `${prompt} ${line}` : `${continuation}${line}`,
		);
		return new Text(headerLines.join("\n"), 1, 0);
	}

	constructor(
		private readonly code: string,
		ui: TUI,
		private readonly excludeFromContext = false,
	) {
		super();

		const colorKey = this.excludeFromContext ? "dim" : "pythonMode";
		const borderColor = (str: string) => theme.fg(colorKey, str);

		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder(borderColor));

		this.#contentContainer = new Container();
		this.addChild(this.#contentContainer);
		this.#contentContainer.addChild(this.#formatHeader(colorKey));

		this.#loader = new Loader(
			ui,
			spinner => theme.fg(colorKey, spinner),
			text => theme.fg("muted", text),
			`Running… (esc to cancel)`,
			getSymbolTheme().spinnerFrames,
		);
		this.#contentContainer.addChild(this.#loader);

		this.addChild(new DynamicBorder(borderColor));
	}

	setExpanded(expanded: boolean): void {
		this.#expanded = expanded;
		this.#updateDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		this.#updateDisplay();
	}

	appendOutput(chunk: string): void {
		// Chunk is pre-sanitized by OutputSink.push() — no need to sanitize again.
		const newLines = chunk.split("\n").map(line => this.#clampDisplayLine(line));
		if (this.#outputLines.length > 0 && newLines.length > 0) {
			this.#outputLines[this.#outputLines.length - 1] = this.#clampDisplayLine(
				`${this.#outputLines[this.#outputLines.length - 1]}${newLines[0]}`,
			);
			this.#outputLines.push(...newLines.slice(1));
		} else {
			this.#outputLines.push(...newLines);
		}

		this.#updateDisplay();
	}

	/**
	 * Gutter-outcome for this execution once a terminal status has been set.
	 * "error" for cancelled, non-zero exit, or an uncaught executor exception;
	 * "success" for clean zero exit; undefined while still running.
	 */
	get outcome(): "success" | "error" | undefined {
		if (this.#status === "running") return undefined;
		return this.#status === "complete" ? "success" : "error";
	}

	/**
	 * Terminal state for an uncaught executor exception — distinct from a
	 * non-zero interpreter exit (which uses `setComplete`). Footer renders
	 * `(error: <message>)`. Idempotent after the first terminal call.
	 */
	setError(err: Error | string): void {
		if (this.#status !== "running") return;
		this.#status = "errored";
		this.#errorMessage = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
		this.#loader.stop();
		this.#updateDisplay();
	}

	setComplete(
		exitCode: number | undefined,
		cancelled: boolean,
		options?: { output?: string; truncation?: TruncationMeta },
	): void {
		this.#exitCode = exitCode;
		this.#status = cancelled
			? "cancelled"
			: exitCode !== 0 && exitCode !== undefined && exitCode !== null
				? "error"
				: "complete";
		this.#truncation = options?.truncation;
		if (options?.output !== undefined) {
			this.#setOutput(options.output);
		}

		this.#loader.stop();
		this.#updateDisplay();
	}

	#updateDisplay(): void {
		const availableLines = this.#outputLines;
		const previewLogicalLines = availableLines.slice(-PREVIEW_LINES);
		const hiddenLineCount = availableLines.length - previewLogicalLines.length;

		this.#contentContainer.clear();

		const colorKey = this.excludeFromContext ? "dim" : "pythonMode";
		this.#contentContainer.addChild(this.#formatHeader(colorKey));

		if (availableLines.length > 0) {
			// Try to syntax-highlight structured output (e.g. JSON)
			const highlightedLines = highlightIfStructured(availableLines);

			if (this.#expanded) {
				const displayText = highlightedLines
					? highlightedLines.join("\n")
					: availableLines.map(line => theme.fg("muted", line)).join("\n");
				this.#contentContainer.addChild(new Text(`\n${displayText}`, 1, 0));
			} else {
				const previewHighlighted = highlightedLines
					? highlightedLines.slice(-previewLogicalLines.length).join("\n")
					: previewLogicalLines.map(line => theme.fg("muted", line)).join("\n");
				const previewText = `\n${previewHighlighted}`;
				this.#contentContainer.addChild({
					render: (width: number) => {
						const { visualLines } = truncateToVisualLines(previewText, PREVIEW_LINES, width, 1);
						return visualLines;
					},
					invalidate: () => {},
				});
			}
		}

		if (this.#status === "running") {
			this.#contentContainer.addChild(this.#loader);
		} else {
			const statusParts: string[] = [];

			if (hiddenLineCount > 0) {
				statusParts.push(theme.fg("dim", `… ${hiddenLineCount} more lines (ctrl+o to expand)`));
			}

			if (this.#status === "cancelled") {
				statusParts.push(theme.fg("warning", "(cancelled)"));
			} else if (this.#status === "error") {
				statusParts.push(theme.fg("error", `(exit ${this.#exitCode})`));
			} else if (this.#status === "errored") {
				// `\u00a0` (NBSP) keeps the wrapper joined to the message so
				// the Text component does not wrap at "(error:_<msg>)" in
				// narrow terminals.
				statusParts.push(theme.fg("error", `(error:\u00a0${this.#errorMessage ?? "unknown"})`));
			}

			if (this.#truncation) {
				statusParts.push(theme.fg("warning", formatTruncationMetaNotice(this.#truncation)));
			}

			if (statusParts.length > 0) {
				this.#contentContainer.addChild(new Text(`\n${statusParts.join("\n")}`, 1, 0));
			}
		}
	}

	#clampDisplayLine(line: string): string {
		if (line.length <= MAX_DISPLAY_LINE_CHARS) {
			return line;
		}
		const omitted = line.length - MAX_DISPLAY_LINE_CHARS;
		return `${line.slice(0, MAX_DISPLAY_LINE_CHARS)}… [${omitted} chars omitted]`;
	}

	#setOutput(output: string): void {
		const clean = sanitizeText(output);
		this.#outputLines = clean ? clean.split("\n").map(line => this.#clampDisplayLine(line)) : [];
	}

	getOutput(): string {
		return this.#outputLines.join("\n");
	}

	getCode(): string {
		return this.code;
	}
}
