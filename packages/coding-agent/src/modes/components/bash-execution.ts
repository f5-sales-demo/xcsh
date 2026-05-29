/**
 * Component for displaying bash command execution with streaming output.
 */

import { sanitizeText } from "@f5xc-salesdemos/pi-natives";
import { Container, Image, Loader, Spacer, Text, type TUI } from "@f5xc-salesdemos/pi-tui";
import { getSymbolTheme, highlightCode, theme } from "../../modes/theme/theme";
import { formatTruncationMetaNotice, type TruncationMeta } from "../../tools/output-meta";
import { resolveImageOptions } from "../../tools/render-utils";
import {
	extractITerm2ImageData,
	getImageLineMask,
	isImagePassthroughEnabled,
	sanitizeWithImagePassthrough,
} from "../../utils/image-passthrough";
import { sanitizeErrorMessage } from "../utils/sanitize-error-message";
import { DynamicBorder } from "./dynamic-border";
import { truncateToVisualLines } from "./visual-truncate";

// Preview line limit when not expanded (matches tool execution behavior)
const PREVIEW_LINES = 20;
const STREAMING_LINE_CAP = PREVIEW_LINES * 5;

/** Max bytes to attempt JSON detection on (avoid parsing huge outputs) */
const JSON_DETECT_LIMIT = 32_768;

/**
 * Detect if output looks like JSON and return syntax-highlighted lines.
 * Returns undefined if not JSON or if detection should not be attempted.
 */
function highlightIfStructured(lines: string[]): string[] | undefined {
	if (lines.length === 0) return undefined;
	const firstNonEmpty = lines.find(l => l.trim().length > 0)?.trim();
	if (!firstNonEmpty) return undefined;
	// Only detect JSON (starts with { or [)
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
const MAX_DISPLAY_LINE_CHARS = 4000;
// Minimum interval between processing incoming chunks for display (ms).
// Chunks arriving faster than this are accumulated and processed in one batch.
const CHUNK_THROTTLE_MS = 50;

export class BashExecutionComponent extends Container {
	#outputLines: string[] = [];
	// Failure-mode taxonomy:
	//   "complete"  — zero exit
	//   "error"     — non-zero exit (shell reported failure)
	//   "cancelled" — user cancelled (e.g. pressed Esc)
	//   "errored"   — uncaught exception (executor threw; no exit code)
	#status: "running" | "complete" | "cancelled" | "error" | "errored" = "running";
	#exitCode: number | undefined = undefined;
	#errorMessage: string | undefined = undefined;
	#loader: Loader;
	#truncation?: TruncationMeta;
	#expanded = false;
	#displayDirty = false;
	#chunkGate = false;
	#contentContainer: Container;
	#headerText: Text;
	#imageComponent?: Image;

	constructor(
		private readonly command: string,
		ui: TUI,
		excludeFromContext = false,
	) {
		super();

		// Use dim border for excluded-from-context commands (!! prefix)
		const colorKey = excludeFromContext ? "dim" : "bashMode";
		const borderColor = (str: string) => theme.fg(colorKey, str);

		// Add spacer
		this.addChild(new Spacer(1));

		// Top border
		this.addChild(new DynamicBorder(borderColor));

		// Content container (holds dynamic content between borders)
		this.#contentContainer = new Container();
		this.addChild(this.#contentContainer);

		// Command header
		this.#headerText = new Text(theme.fg(colorKey, theme.bold(`$ ${command}`)), 1, 0);
		this.#contentContainer.addChild(this.#headerText);

		// Loader
		this.#loader = new Loader(
			ui,
			spinner => theme.fg(colorKey, spinner),
			text => theme.fg("muted", text),
			`Running… (esc to cancel)`,
			getSymbolTheme().spinnerFrames,
		);
		this.#contentContainer.addChild(this.#loader);

		// Bottom border
		this.addChild(new DynamicBorder(borderColor));
	}

	/**
	 * Set whether the output is expanded (shows full output) or collapsed (preview only).
	 */
	setExpanded(expanded: boolean): void {
		this.#expanded = expanded;
		this.#updateDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		this.#displayDirty = false;
		this.#updateDisplay();
	}

	appendOutput(chunk: string): void {
		// During high-throughput output (e.g. seq 1 500M), processing every
		// chunk would saturate the event loop. Instead, accept one chunk per
		// throttle window and drop the rest — the OutputSink captures everything
		// for the artifact, and setComplete() replaces with the final output.
		if (this.#chunkGate) return;
		this.#chunkGate = true;
		setTimeout(() => {
			this.#chunkGate = false;
		}, CHUNK_THROTTLE_MS);

		const incomingLines = chunk.split("\n");
		if (this.#outputLines.length > 0 && incomingLines.length > 0) {
			const lastIndex = this.#outputLines.length - 1;
			const mergedLines = [`${this.#outputLines[lastIndex]}${incomingLines[0]}`, ...incomingLines.slice(1)];
			const clampedMergedLines = this.#clampLinesPreservingSixel(mergedLines);
			this.#outputLines[lastIndex] = clampedMergedLines[0] ?? "";
			this.#outputLines.push(...clampedMergedLines.slice(1));
		} else {
			this.#outputLines.push(...this.#clampLinesPreservingSixel(incomingLines));
		}

		// Cap stored lines during streaming to avoid unbounded memory growth
		if (this.#outputLines.length > STREAMING_LINE_CAP) {
			this.#outputLines = this.#outputLines.slice(-STREAMING_LINE_CAP);
		}

		this.#displayDirty = true;
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
	 * non-zero shell exit (which uses `setComplete`). Footer renders
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

		// Stop loader
		this.#loader.stop();

		this.#updateDisplay();
	}

	override render(width: number): string[] {
		if (this.#displayDirty) {
			this.#displayDirty = false;
			this.#updateDisplay();
		}
		return super.render(width);
	}

	#updateDisplay(): void {
		const availableLines = this.#outputLines;

		// Apply preview truncation based on expanded state
		const previewLogicalLines = availableLines.slice(-PREVIEW_LINES);
		const hiddenLineCount = availableLines.length - previewLogicalLines.length;
		const imageLineMask = isImagePassthroughEnabled() ? getImageLineMask(availableLines) : undefined;
		const hasImageOutput = imageLineMask?.some(Boolean) ?? false;

		// Rebuild content container
		this.#contentContainer.clear();

		// Command header
		this.#contentContainer.addChild(this.#headerText);

		// Render extracted image via the Image component (proper height calculation)
		if (this.#imageComponent && this.#status !== "running") {
			this.#contentContainer.addChild(new Spacer(1));
			this.#contentContainer.addChild(this.#imageComponent);
		}

		// Output (text lines, excluding image lines which are handled above)
		if (availableLines.length > 0) {
			// Try to syntax-highlight structured output (e.g. JSON)
			const highlightedLines = hasImageOutput ? undefined : highlightIfStructured(availableLines);

			if (this.#expanded || hasImageOutput) {
				const displayText = highlightedLines
					? highlightedLines.join("\n")
					: availableLines
							.map((line, index) => (imageLineMask?.[index] ? line : theme.fg("muted", line)))
							.join("\n");
				this.#contentContainer.addChild(new Text(`\n${displayText}`, 1, 0));
			} else {
				// Use shared visual truncation utility, recomputed per render width
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

		// Loader or status
		if (this.#status === "running") {
			this.#contentContainer.addChild(this.#loader);
		} else {
			const statusParts: string[] = [];

			// Show how many lines are hidden (collapsed preview)
			if (hiddenLineCount > 0 && !hasImageOutput) {
				statusParts.push(theme.fg("dim", `… ${hiddenLineCount} more lines (ctrl+o to expand)`));
			}

			if (this.#status === "cancelled") {
				statusParts.push(theme.fg("warning", "(cancelled)"));
			} else if (this.#status === "error") {
				statusParts.push(theme.fg("error", `(exit ${this.#exitCode})`));
			} else if (this.#status === "errored") {
				// `\u00a0` (NBSP) keeps the wrapper joined to the message so
				// the Text component does not wrap at "(error:_<msg>)" in
				// narrow terminals. Falls back to "unknown" if setError was
				// never called with a message.
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

	#clampLinesPreservingSixel(lines: string[]): string[] {
		if (lines.length === 0) return [];
		const imageLineMask = getImageLineMask(lines);
		if (!imageLineMask.some(Boolean)) {
			return lines.map(line => this.#clampDisplayLine(line));
		}
		return lines.map((line, index) => (imageLineMask[index] ? line : this.#clampDisplayLine(line)));
	}

	#setOutput(output: string): void {
		const clean = sanitizeWithImagePassthrough(output, sanitizeText);
		this.#outputLines = clean ? this.#clampLinesPreservingSixel(clean.split("\n")) : [];

		// If the output contains iTerm2 image data, extract it and create an
		// Image component for proper height calculation instead of raw passthrough.
		this.#imageComponent = undefined;
		if (isImagePassthroughEnabled()) {
			const imageData = extractITerm2ImageData(output);
			if (imageData) {
				this.#imageComponent = new Image(
					imageData.base64,
					imageData.mimeType,
					{ fallbackColor: (s: string) => theme.fg("muted", s) },
					resolveImageOptions(),
				);
				// Strip image lines and trailing empty lines so they don't
				// render as extra whitespace below the image
				const mask = getImageLineMask(this.#outputLines);
				this.#outputLines = this.#outputLines.filter((_, i) => !mask[i]);
				while (this.#outputLines.length > 0 && this.#outputLines[this.#outputLines.length - 1] === "") {
					this.#outputLines.pop();
				}
			}
		}
	}

	/**
	 * Get the raw output for creating BashExecutionMessage.
	 */
	getOutput(): string {
		return this.#outputLines.join("\n");
	}

	/**
	 * Get the command that was executed.
	 */
	getCommand(): string {
		return this.command;
	}
}
