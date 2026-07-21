// @f5-sales-demo/xcsh-chat-ui — shared F5 xcsh-terminal chat UI.
// Phase 1: the framework-free design-token layer.
// Phase 2: the shared React-idiom chat components (headless of transport/state).

export { ActivationOverlay, type ActivationOverlayProps } from "./components/ActivationOverlay";
// ── Composer + footer controls + status bar ───────────────────────────────
export { Composer, type ComposerProps } from "./components/Composer";
export { ContentBlockRenderer, type ContentBlockRendererProps } from "./components/ContentBlockRenderer";
export { ContextChip, type ContextChipProps } from "./components/ContextChip";
export { EmptyState, type EmptyStateProps } from "./components/EmptyState";
// ── Gateway config ────────────────────────────────────────────────────────
export { GatewayConfigForm, type GatewayConfigFormProps } from "./components/GatewayConfigForm";
export { GatewayGate, type GatewayGateProps } from "./components/GatewayGate";
// ── Shell (header / empty state / context chip / activation overlay) ───────
export { HeaderBar, type HeaderBarProps } from "./components/HeaderBar";
export { PlusIcon, SendIcon, StopIcon } from "./components/icons";
export { MarkdownRenderer, type MarkdownRendererProps } from "./components/MarkdownRenderer";
export { ModelSelector, type ModelSelectorProps } from "./components/ModelSelector";
export { ModeToggle, type ModeToggleProps } from "./components/ModeToggle";
export {
	AssistantMessage,
	ErrorMessage,
	GutterRow,
	ThinkingIndicator,
	ToolMessage,
	UserMessage,
} from "./components/messages";
export { StatusBar, type StatusBarProps } from "./components/StatusBar";
export { ThinkingBlock, type ThinkingBlockProps } from "./components/ThinkingBlock";
export { ToolUseContent, type ToolUseContentProps } from "./components/ToolUseContent";
// ── Transcript + message renderers ────────────────────────────────────────
export { Transcript, type TranscriptProps } from "./components/Transcript";
// ── Shared hooks ──────────────────────────────────────────────────────────
export { useAutoClose } from "./components/useAutoClose";
// ── Markdown ──────────────────────────────────────────────────────────────
export { escapeHtml, isSafeUrl, renderMarkdown } from "./markdown/render";
export { F5Logo, type F5LogoProps } from "./theme/F5Logo";
export { PANEL_CSS } from "./theme/panel.css";
// ── Theme (tokens + panel stylesheet + logo) ──────────────────────────────
export {
	COLORS,
	type ColorName,
	cssVars,
	FONT_FACES,
	FONT_STACK,
	fontFaceCss,
	GLYPHS,
	injectFontFaces,
	injectTokens,
} from "./theme/tokens";

// ── View-model + prop types ───────────────────────────────────────────────
export type {
	ActivationGate,
	ChatMessage,
	ChatRole,
	ContentBlock,
	GateStatus,
	GatewayConfigDraft,
	GatewayValidateResult,
	InteractionMode,
	MenuItem,
	ModelOption,
	ReactNode,
	SkillPill,
	ToolUseBlock,
} from "./types";
