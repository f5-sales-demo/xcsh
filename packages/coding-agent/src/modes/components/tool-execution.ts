import type { AgentTool, PluginPresentation } from "@f5-sales-demo/pi-agent-core";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import {
	Box,
	type Component,
	Container,
	getImageDimensions,
	Image,
	ImageProtocol,
	imageFallback,
	Spacer,
	TERMINAL,
	Text,
	type TUI,
} from "@f5-sales-demo/pi-tui";
import { getProjectDir, logger } from "@f5-sales-demo/pi-utils";
import { computeEditDiff, computeHashlineDiff, computePatchDiff, type DiffError, type DiffResult } from "../../edit";
import { theme } from "../../modes/theme/theme";
import { BASH_DEFAULT_PREVIEW_LINES } from "../../tools/bash";
import { stripInternalArgs } from "../../tools/json-tree";
import { PYTHON_DEFAULT_PREVIEW_LINES } from "../../tools/python";
import { formatExpandHint, replaceTabs, resolveImageOptions } from "../../tools/render-utils";
import { toolRenderers } from "../../tools/renderers";
import { F5_TOOL_BORDER_COLOR, renderOutputBlock, renderStatusLine } from "../../tui";
import { convertToPng } from "../../utils/image-convert";
import { sanitizeWithImagePassthrough } from "../../utils/image-passthrough";
import { renderDiff } from "./diff";
import { dataSections, fallbackResultView, guardedComponent, PluginViewComponent } from "./plugin-view";

function ensureInvalidate(component: unknown): Component {
	const c = component as { render: Component["render"]; invalidate?: () => void };
	if (!c.invalidate) {
		c.invalidate = () => {};
	}
	return c as Component;
}

function cloneToolArgs<T>(args: T): T {
	if (args === null || args === undefined) return args;
	try {
		return structuredClone(args);
	} catch {
		return args;
	}
}

export interface ToolExecutionOptions {
	showImages?: boolean; // default: true (only used if terminal supports images)
	editFuzzyThreshold?: number;
	editAllowFuzzy?: boolean;
}

export interface ToolExecutionHandle {
	updateArgs(args: any, toolCallId?: string): void;
	updateResult(
		result: {
			content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
			details?: any;
			isError?: boolean;
		},
		isPartial?: boolean,
		toolCallId?: string,
	): void;
	setArgsComplete(toolCallId?: string): void;
	setExpanded(expanded: boolean): void;
}

/**
 * Component that renders a tool call with its result (updateable)
 */
export class ToolExecutionComponent extends Container {
	#contentBox: Box; // Used for custom tools and bash visual truncation
	#contentText: Text; // For built-in tools (with its own padding/bg)
	#multiFileBoxes: (Box | Spacer)[] = []; // Extra boxes for multi-file edit results
	#imageComponents: Image[] = [];
	#imageSpacers: Spacer[] = [];
	#toolName: string;
	#toolLabel: string;
	#args: any;
	#expanded = false;
	#showImages: boolean;
	#editFuzzyThreshold: number | undefined;
	#editAllowFuzzy: boolean | undefined;
	#isPartial = true;
	#tool?: AgentTool;
	#ui: TUI;
	#cwd: string;
	#result?: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		isError?: boolean;
		details?: any;
	};
	// Cached edit diff preview (computed when args arrive, before tool executes)
	#editDiffPreview?: DiffResult | DiffError;
	#editDiffArgsKey?: string; // Track which args the preview is for
	// Cached converted images for Kitty protocol (which requires PNG), keyed by index
	#convertedImages: Map<number, { data: string; mimeType: string }> = new Map();
	// Spinner animation for partial task results
	#spinnerFrame?: number;
	#spinnerInterval?: NodeJS.Timeout;
	// Track if args are still being streamed (for edit/write spinner)
	#argsComplete = false;
	// True when this component uses #contentText (fallback path, no custom renderer)
	#usesFallbackText = false;
	#renderState: {
		spinnerFrame?: number;
		expanded: boolean;
		isPartial: boolean;
		renderContext?: Record<string, unknown>;
	} = {
		expanded: false,
		isPartial: true,
	};

	constructor(
		toolName: string,
		args: any,
		options: ToolExecutionOptions = {},
		tool: AgentTool | undefined,
		ui: TUI,
		cwd: string = getProjectDir(),
		_toolCallId?: string,
	) {
		super();
		this.#toolName = toolName;
		this.#toolLabel = tool?.label ?? toolName;
		this.#showImages = options.showImages ?? true;
		this.#editFuzzyThreshold = options.editFuzzyThreshold;
		this.#editAllowFuzzy = options.editAllowFuzzy;
		this.#tool = tool;
		this.#ui = ui;
		this.#cwd = cwd;
		this.#args = cloneToolArgs(args);
		// Always create both - contentBox for custom tools/bash/tools with renderers, contentText for other built-ins
		this.#contentBox = new Box(1, 0, (text: string) => theme.bg("toolPendingBg", text));
		this.#contentText = new Text("", 1, 0, (text: string) => theme.bg("toolPendingBg", text));

		// Use Box for custom tools or built-in tools that have renderers
		const hasRenderer = toolName in toolRenderers;
		const hasCustomRenderer = !!(tool?.renderCall || tool?.renderResult || tool?.presentation);
		if (hasCustomRenderer || hasRenderer) {
			this.addChild(this.#contentBox);
		} else {
			this.#usesFallbackText = true;
			this.addChild(this.#contentText);
		}

		this.#updateDisplay();
	}

	updateArgs(args: any, _toolCallId?: string): void {
		this.#args = cloneToolArgs(args);
		this.#updateSpinnerAnimation();
		this.#updateDisplay();
	}

	/**
	 * Signal that args are complete (tool is about to execute).
	 * This triggers diff computation for edit tool.
	 */
	setArgsComplete(_toolCallId?: string): void {
		this.#argsComplete = true;
		this.#updateSpinnerAnimation();
		this.#maybeComputeEditDiff();
	}

	/**
	 * Compute edit diff preview when we have complete args.
	 * This runs async and updates display when done.
	 */
	#maybeComputeEditDiff(): void {
		if (this.#toolName !== "edit") return;

		const edits = this.#args?.edits;
		if (!Array.isArray(edits) || edits.length === 0) return;

		const first = edits[0];
		if (!first || typeof first !== "object") return;

		// Detect mode from first edit entry shape and compute preview for first file
		if ("old_text" in first && "new_text" in first) {
			// Replace mode
			const { path, old_text: oldText, new_text: newText, all } = first;
			if (!path || oldText === undefined || newText === undefined) return;

			const argsKey = JSON.stringify({ path, oldText, newText, all });
			if (this.#editDiffArgsKey === argsKey) return;
			this.#editDiffArgsKey = argsKey;

			computeEditDiff(path, oldText, newText, this.#cwd, true, all, this.#editFuzzyThreshold).then(result => {
				if (this.#editDiffArgsKey === argsKey) {
					this.#editDiffPreview = result;
					this.#updateDisplay();
					this.#ui.requestRender();
				}
			});
		} else if ("path" in first && ("diff" in first || ("op" in first && !("content" in first)))) {
			// Patch mode (has diff or op without content — chunk edits always have content)
			const { path, op, rename, diff } = first;
			if (!path) return;

			const argsKey = JSON.stringify({ path, op, rename, diff });
			if (this.#editDiffArgsKey === argsKey) return;
			this.#editDiffArgsKey = argsKey;

			computePatchDiff({ path, op, rename, diff }, this.#cwd, {
				fuzzyThreshold: this.#editFuzzyThreshold,
				allowFuzzy: this.#editAllowFuzzy,
			}).then(result => {
				if (this.#editDiffArgsKey === argsKey) {
					this.#editDiffPreview = result;
					this.#updateDisplay();
					this.#ui.requestRender();
				}
			});
		} else if ("loc" in first && "path" in first) {
			// Hashline mode — group edits by path, preview first file
			const path = first.path;
			if (!path) return;
			const fileEdits = edits.filter((e: any) => e.path === path);
			const move = this.#args?.move;

			const argsKey = JSON.stringify({ path, edits: fileEdits, move });
			if (this.#editDiffArgsKey === argsKey) return;
			this.#editDiffArgsKey = argsKey;

			computeHashlineDiff({ path, edits: fileEdits, move }, this.#cwd).then(result => {
				if (this.#editDiffArgsKey === argsKey) {
					this.#editDiffPreview = result;
					this.#updateDisplay();
					this.#ui.requestRender();
				}
			});
		}
		// Chunk mode edits don't have a pre-execution diff preview
	}

	updateResult(
		result: {
			content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
			details?: any;
			isError?: boolean;
		},
		isPartial = false,
		_toolCallId?: string,
	): void {
		this.#result = result;
		this.#isPartial = isPartial;
		// When tool is complete, ensure args are marked complete so spinner stops
		if (!isPartial) {
			this.#argsComplete = true;
		}
		this.#updateSpinnerAnimation();
		this.#updateDisplay();
		// Convert non-PNG images to PNG for Kitty protocol (async)
		this.#maybeConvertImagesForKitty();
	}

	/**
	 * Get all image blocks from result content and details.images.
	 * Some tools (like generate_image) store images in details to avoid bloating model context.
	 */
	#getAllImageBlocks(): Array<{ data?: string; mimeType?: string }> {
		if (!this.#result) return [];
		const contentImages = this.#result.content?.filter((c: any) => c.type === "image") || [];
		const detailImages = this.#result.details?.images || [];
		return [...contentImages, ...detailImages];
	}

	/**
	 * Convert non-PNG images to PNG for Kitty graphics protocol.
	 * Kitty requires PNG format (f=100), so JPEG/GIF/WebP won't display.
	 */
	#maybeConvertImagesForKitty(): void {
		// Only needed for Kitty protocol
		if (TERMINAL.imageProtocol !== ImageProtocol.Kitty) return;
		if (!this.#result) return;

		const imageBlocks = this.#getAllImageBlocks();

		for (let i = 0; i < imageBlocks.length; i++) {
			const img = imageBlocks[i];
			if (!img.data || !img.mimeType) continue;
			// Skip if already PNG or already converted
			if (img.mimeType === "image/png") continue;
			if (this.#convertedImages.has(i)) continue;

			// Convert async - catch errors from processing
			const index = i;
			convertToPng(img.data, img.mimeType)
				.then(converted => {
					if (converted) {
						this.#convertedImages.set(index, converted);
						this.#updateDisplay();
						this.#ui.requestRender();
					}
				})
				.catch(() => {
					// Ignore conversion failures - display will use original image format
				});
		}
	}

	/**
	 * Start or stop spinner animation based on whether this is a partial task result.
	 */
	#updateSpinnerAnimation(): void {
		// Spinner for: task tool with partial result, or edit/write while args streaming
		const isStreamingArgs = !this.#argsComplete && (this.#toolName === "edit" || this.#toolName === "write");
		const isBackgroundAsyncTask =
			this.#toolName === "task" &&
			(this.#result?.details as { async?: { state?: string } } | undefined)?.async?.state === "running";
		const isPartialTask = this.#isPartial && this.#toolName === "task" && !isBackgroundAsyncTask;
		const needsSpinner = isStreamingArgs || isPartialTask;
		if (needsSpinner && !this.#spinnerInterval) {
			this.#spinnerInterval = setInterval(() => {
				const frameCount = theme.spinnerFrames.length;
				if (frameCount === 0) return;
				this.#spinnerFrame = ((this.#spinnerFrame ?? -1) + 1) % frameCount;
				this.#renderState.spinnerFrame = this.#spinnerFrame;
				this.#ui.requestRender();
			}, 80);
		} else if (!needsSpinner && this.#spinnerInterval) {
			clearInterval(this.#spinnerInterval);
			this.#spinnerInterval = undefined;
		}
	}

	/**
	 * Stop spinner animation and cleanup resources.
	 */
	stopAnimation(): void {
		if (this.#spinnerInterval) {
			clearInterval(this.#spinnerInterval);
			this.#spinnerInterval = undefined;
			this.#spinnerFrame = undefined;
		}
	}

	setExpanded(expanded: boolean): void {
		this.#expanded = expanded;
		this.#updateDisplay();
	}

	setShowImages(show: boolean): void {
		this.#showImages = show;
		this.#updateDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		this.#updateDisplay();
	}

	override render(width: number): string[] {
		// For fallback tools (no custom renderer), regenerate text with the
		// correct width at render-time instead of using the hardcoded default.
		if (this.#usesFallbackText) {
			this.#contentText.setText(this.#formatToolExecution(width));
		}
		return super.render(width);
	}

	#updateDisplay(): void {
		// Set background based on state
		const bgFn = this.#isPartial
			? (text: string) => theme.bg("toolPendingBg", text)
			: this.#result?.isError
				? (text: string) => theme.bg("toolErrorBg", text)
				: (text: string) => theme.bg("toolSuccessBg", text);

		// Sync shared mutable render state for component closures
		this.#renderState.expanded = this.#expanded;
		this.#renderState.isPartial = this.#isPartial;
		this.#renderState.spinnerFrame = this.#spinnerFrame;

		// Explicit components, data-only presentation, then shared themed fallback.
		if (this.#tool?.presentation && !this.#tool.renderCall && !this.#tool.renderResult) {
			// Data-only marketplace tools use the same thin frame and status chrome as XC-API.
			this.#contentBox.setBgFn(undefined);
			this.#contentBox.setPaddingX(0);
			this.#contentBox.clear();
			this.#contentBox.addChild({
				render: width => this.#framedPluginView(width),
				invalidate() {},
			});
		} else if (this.#tool && (this.#tool.renderCall || this.#tool.renderResult || this.#tool.presentation)) {
			const tool = this.#tool;
			const merged = Boolean((tool as { mergeCallAndResult?: boolean }).mergeCallAndResult);
			const inline = Boolean((tool as { inline?: boolean }).inline);
			this.#contentBox.setBgFn(inline ? undefined : bgFn);
			this.#contentBox.setPaddingX(0);
			this.#contentBox.clear();
			if (!this.#result || !merged) {
				const fallback = this.#callView();
				this.#contentBox.addChild(
					tool.renderCall
						? guardedComponent(
								() =>
									ensureInvalidate(tool.renderCall!(this.#getCallArgsForRender(), this.#renderState, theme)),
								fallback,
							)
						: fallback,
				);
			}
			if (this.#result) {
				const fallback = this.#resultView();
				this.#contentBox.addChild(
					tool.renderResult
						? guardedComponent(
								() =>
									ensureInvalidate(
										(tool.renderResult as (...args: any[]) => Component)(
											this.#result,
											this.#renderState,
											theme,
											this.#args,
										),
									),
								fallback,
							)
						: fallback,
				);
			}
		} else if (this.#toolName in toolRenderers) {
			// Built-in tools with renderers
			const renderer = toolRenderers[this.#toolName];

			// Clean up previous multi-file boxes
			for (const box of this.#multiFileBoxes) {
				this.removeChild(box);
			}
			this.#multiFileBoxes = [];

			// Check for multi-file edit results
			const perFileResults = this.#result?.details?.perFileResults as
				| Array<{ path: string; isError?: boolean }>
				| undefined;
			if (perFileResults && perFileResults.length > 1) {
				// Multi-file: render each file as its own Box (identical to separate tool calls)
				this.#contentBox.setBgFn(undefined);
				this.#contentBox.clear();

				const renderContext = this.#buildRenderContext();
				this.#renderState.renderContext = renderContext;

				for (let i = 0; i < perFileResults.length; i++) {
					const fileResult = perFileResults[i];
					if (i > 0) {
						const spacer = new Spacer(1);
						this.#multiFileBoxes.push(spacer);
						this.addChild(spacer);
					}
					const fileBgFn = fileResult.isError
						? (text: string) => theme.bg("toolErrorBg", text)
						: (text: string) => theme.bg("toolSuccessBg", text);
					const fileBox = new Box(1, 0, fileBgFn);
					try {
						const resultComponent = renderer.renderResult(
							{ content: [], details: fileResult, isError: fileResult.isError },
							this.#renderState,
							theme,
						);
						if (resultComponent) {
							fileBox.addChild(ensureInvalidate(resultComponent));
						}
					} catch (err) {
						logger.warn("Tool renderer failed", { tool: this.#toolName, error: String(err) });
					}
					this.#multiFileBoxes.push(fileBox);
					this.addChild(fileBox);
				}

				// Show pending indicator for remaining files
				const totalFiles = this.#args?.edits
					? new Set((this.#args.edits as any[]).map((e: any) => e?.path).filter(Boolean)).size
					: 0;
				const remaining = Math.max(0, totalFiles - perFileResults.length);
				if (remaining > 0 && this.#isPartial) {
					const pendingSpacer = new Spacer(1);
					this.#multiFileBoxes.push(pendingSpacer);
					this.addChild(pendingSpacer);
					const pendingBox = new Box(1, 0, (text: string) => theme.bg("toolPendingBg", text));
					const pendingText = renderStatusLine(
						{
							icon: "pending",
							title: "Edit",
							description: theme.fg("dim", `${remaining} more file${remaining > 1 ? "s" : ""} pending…`),
						},
						theme,
					);
					pendingBox.addChild(new Text(pendingText, 0, 0));
					this.#multiFileBoxes.push(pendingBox);
					this.addChild(pendingBox);
				}
			} else {
				// Single-file or no result: standard rendering
				// Inline renderers skip background styling; content sits flush with the gutter.
				this.#contentBox.setBgFn(renderer.inline ? undefined : bgFn);
				this.#contentBox.setPaddingX(0);
				this.#contentBox.clear();

				const shouldRenderCall = !this.#result || !renderer.mergeCallAndResult;
				if (shouldRenderCall) {
					// Render call component
					try {
						const callComponent = renderer.renderCall(this.#getCallArgsForRender(), this.#renderState, theme);
						if (callComponent) {
							this.#contentBox.addChild(ensureInvalidate(callComponent));
						}
					} catch (err) {
						logger.warn("Tool renderer failed", { tool: this.#toolName, error: String(err) });
						// Fall back to default on error
						this.#contentBox.addChild(new Text(theme.fg("toolTitle", theme.bold(this.#toolLabel)), 0, 0));
					}
				}

				// Render result component if we have a result
				if (this.#result) {
					try {
						// Build render context for tools that need extra state
						const renderContext = this.#buildRenderContext();
						this.#renderState.renderContext = renderContext;

						const resultComponent = renderer.renderResult(
							{
								content: this.#result.content as any,
								details: this.#result.details,
								isError: this.#result.isError,
							},
							this.#renderState,
							theme,
							this.#getCallArgsForRender(),
						);
						if (resultComponent) {
							this.#contentBox.addChild(ensureInvalidate(resultComponent));
						}
					} catch (err) {
						logger.warn("Tool renderer failed", { tool: this.#toolName, error: String(err) });
						// Fall back to showing raw output on error
						const output = this.#getTextOutput();
						if (output) {
							this.#contentBox.addChild(new Text(theme.fg("toolOutput", replaceTabs(output)), 0, 0));
						}
					}
				}
			}
		} else {
			// Other built-in tools: bg is set eagerly; text content is generated
			// lazily in render(width) so truncation respects the actual available width.
			this.#contentText.setCustomBgFn(bgFn);
		}

		// Handle images (same for both custom and built-in)
		for (const img of this.#imageComponents) {
			this.removeChild(img);
		}
		this.#imageComponents = [];
		for (const spacer of this.#imageSpacers) {
			this.removeChild(spacer);
		}
		this.#imageSpacers = [];

		if (this.#result) {
			const imageBlocks = this.#getAllImageBlocks();

			for (let i = 0; i < imageBlocks.length; i++) {
				const img = imageBlocks[i];
				if (TERMINAL.imageProtocol && this.#showImages && img.data && img.mimeType) {
					// Use converted PNG for Kitty protocol if available
					const converted = this.#convertedImages.get(i);
					const imageData = converted?.data ?? img.data;
					const imageMimeType = converted?.mimeType ?? img.mimeType;

					// For Kitty, skip non-PNG images that haven't been converted yet
					if (TERMINAL.imageProtocol === ImageProtocol.Kitty && imageMimeType !== "image/png") {
						continue;
					}

					const spacer = new Spacer(1);
					this.addChild(spacer);
					this.#imageSpacers.push(spacer);
					const imageComponent = new Image(
						imageData,
						imageMimeType,
						{ fallbackColor: (s: string) => theme.fg("toolOutput", s) },
						resolveImageOptions(),
					);
					this.#imageComponents.push(imageComponent);
					this.addChild(imageComponent);
				}
			}
		}
	}

	#getCallArgsForRender(): any {
		if (this.#toolName !== "edit") {
			return this.#args;
		}
		if (!this.#editDiffPreview || !("diff" in this.#editDiffPreview) || !this.#editDiffPreview.diff) {
			return this.#args;
		}
		return { ...(this.#args as Record<string, unknown>), previewDiff: this.#editDiffPreview.diff };
	}

	/**
	 * Build render context for tools that need extra state (bash, python, edit)
	 */
	#buildRenderContext(): Record<string, unknown> {
		const context: Record<string, unknown> = {};
		const normalizeTimeoutSeconds = (value: unknown, maxSeconds: number): number | undefined => {
			if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
			return Math.max(1, Math.min(maxSeconds, value));
		};

		if (this.#toolName === "bash") {
			// Bash needs render context even before a result exists. The renderer uses the pending-call args
			// plus this context to keep the inline command preview visible while tool-call JSON is still streaming.
			if (this.#result) {
				// Pass raw output and expanded state - renderer handles width-aware truncation
				const output = this.#getTextOutput().trimEnd();
				context.output = output;
			}
			context.expanded = this.#expanded;
			context.previewLines = BASH_DEFAULT_PREVIEW_LINES;
			context.timeout = normalizeTimeoutSeconds(this.#args?.timeout, 3600);
		} else if (this.#toolName === "python" && this.#result) {
			const output = this.#getTextOutput().trimEnd();
			context.output = output;
			context.expanded = this.#expanded;
			context.previewLines = PYTHON_DEFAULT_PREVIEW_LINES;
			context.timeout = normalizeTimeoutSeconds(this.#args?.timeout, 600);
		} else if (this.#toolName === "edit") {
			// Edit needs diff preview and renderDiff function
			context.editDiffPreview = this.#editDiffPreview;
			context.renderDiff = renderDiff;
		}

		return context;
	}

	#getTextOutput(): string {
		if (!this.#result) return "";

		const textBlocks = this.#result.content?.filter((c: any) => c.type === "text") || [];
		const imageBlocks = this.#getAllImageBlocks();

		let output = textBlocks
			.map((c: any) => {
				return sanitizeWithImagePassthrough(c.text || "", sanitizeText);
			})
			.join("\n");

		if (imageBlocks.length > 0 && (!TERMINAL.imageProtocol || !this.#showImages)) {
			const imageIndicators = imageBlocks
				.map((img: any) => {
					const dims = img.data ? (getImageDimensions(img.data, img.mimeType) ?? undefined) : undefined;
					return imageFallback(img.mimeType, dims);
				})
				.join("\n");
			output = output ? `${output}\n${imageIndicators}` : imageIndicators;
		}

		return output;
	}

	#callView(): Component {
		const args =
			!this.#expanded && this.#args && typeof this.#args === "object" && !Array.isArray(this.#args)
				? stripInternalArgs(this.#args)
				: this.#args;
		const fallback = new PluginViewComponent(
			() => ({
				summary: renderStatusLine({ icon: this.#isPartial ? "pending" : undefined, title: this.#toolLabel }, theme),
				sections: dataSections(args, this.#expanded ? "Args" : undefined),
			}),
			this.#expanded,
		);
		const descriptor = this.#tool?.presentation as PluginPresentation | undefined;
		return descriptor?.call
			? guardedComponent(
					() =>
						new PluginViewComponent(
							() =>
								descriptor.call!(structuredClone(args), {
									expanded: this.#expanded,
									isPartial: this.#isPartial,
								}),
							this.#expanded,
							false,
							fallback,
						),
					fallback,
				)
			: fallback;
	}

	#resultView(): Component {
		const result = this.#result!;
		const fallback = new PluginViewComponent(
			() => fallbackResultView(result),
			this.#expanded,
			Boolean(result.isError),
		);
		const descriptor = this.#tool?.presentation as PluginPresentation | undefined;
		const presented = descriptor?.result
			? guardedComponent(
					() =>
						new PluginViewComponent(
							() =>
								descriptor.result!(
									structuredClone(result),
									{ expanded: this.#expanded, isPartial: this.#isPartial },
									structuredClone(this.#args),
								),
							this.#expanded,
							Boolean(result.isError),
							fallback,
						),
					fallback,
				)
			: fallback;
		return {
			invalidate: () => presented.invalidate(),
			render: width => {
				const lines = presented.render(width);
				// Retain every source field, argument, error and advisory for transcript inspection.
				if (descriptor?.result && this.#expanded) {
					lines.push(...fallback.render(width));
				}
				if (this.#expanded && result.details !== undefined) {
					lines.push(
						...new PluginViewComponent(
							() => ({ sections: dataSections(result.details, "Details") }),
							true,
						).render(width),
					);
				}
				if (!this.#expanded) lines.push(formatExpandHint(theme, false, true));
				return lines;
			},
		};
	}

	/** Render tables at the frame's inner width so borders never wrap a preformatted row. */
	#framedPluginView(width: number): string[] {
		const innerWidth = Math.max(1, width - 3);
		const pending = !this.#result || this.#isPartial;
		const isError = Boolean(this.#result?.isError);
		const sections: Array<{ label?: string; lines: string[] }> = [];
		if (!this.#result || this.#expanded) {
			const callLines = this.#callView().render(innerWidth);
			// The shared header already carries the tool label. Keep domain summaries in the body.
			if (!this.#tool?.presentation?.call || Bun.stripANSI(callLines[0] ?? "").trim() === this.#toolLabel)
				callLines.shift();
			if (callLines.length)
				sections.push({ label: this.#result ? theme.fg("toolTitle", "Arguments") : undefined, lines: callLines });
		}
		if (this.#result) sections.push({ lines: this.#resultView().render(innerWidth) });
		return renderOutputBlock(
			{
				header: renderStatusLine(
					{
						title: this.#toolLabel,
						icon: pending ? "pending" : undefined,
						spinnerFrame: this.#spinnerFrame,
						badge: {
							label: pending ? "running" : isError ? "failed" : "complete",
							color: pending ? "dim" : isError ? "error" : "success",
						},
					},
					theme,
				),
				state: pending ? "pending" : isError ? "error" : "success",
				sections,
				width,
				borderColor: isError ? undefined : F5_TOOL_BORDER_COLOR,
			},
			theme,
		);
	}

	/** Shared fallback is measured after the Text component's padding is removed. */
	#formatToolExecution(width = 80): string {
		return this.#framedPluginView(Math.max(1, width - 2)).join("\n");
	}
}
