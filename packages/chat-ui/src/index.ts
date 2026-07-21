// @f5-sales-demo/xcsh-chat-ui — shared F5 xcsh-terminal chat UI.
// Phase 1: the framework-free design-token layer.
// Phase 2: the shared React-idiom chat components (headless of transport/state).

// ── Attachments (model + picker) ──────────────────────────────────────────
export {
	type AddResult,
	type Attachment,
	type AttachmentKind,
	addAttachment,
	type BaseAttachment,
	byteLength,
	MAX_ATTACHMENT_BYTES,
	serializeAttachment,
	serializeAttachments,
} from "./attachments/model";
export { ActivationOverlay, type ActivationOverlayProps } from "./components/ActivationOverlay";
export { AttachMenu, type AttachMenuProps } from "./components/AttachMenu";
// ── Composer + footer controls + status bar ───────────────────────────────
export { Composer, type ComposerHandle, type ComposerProps } from "./components/Composer";
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
	type AssistantMessageProps,
	ErrorMessage,
	type ErrorMessageProps,
	GutterRow,
	type GutterRowProps,
	ThinkingIndicator,
	type ThinkingIndicatorProps,
	ToolMessage,
	type ToolMessageProps,
	UserMessage,
	type UserMessageProps,
} from "./components/messages";
export { SlashCommandMenu, type SlashCommandMenuProps } from "./components/SlashCommandMenu";
export { StatusBar, type StatusBarProps } from "./components/StatusBar";
export { ThinkingBlock, type ThinkingBlockProps } from "./components/ThinkingBlock";
export { ToolsPickerMenu, type ToolsPickerMenuProps } from "./components/ToolsPickerMenu";
export { ToolUseContent, type ToolUseContentProps } from "./components/ToolUseContent";
// ── Transcript + message renderers ────────────────────────────────────────
export { Transcript, type TranscriptProps } from "./components/Transcript";
// ── Shared hooks ──────────────────────────────────────────────────────────
export { type UseMenuResult, useMenu } from "./components/useMenu";
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
	UI_COLORS,
} from "./theme/tokens";

// ── View-model + prop types ───────────────────────────────────────────────
export type {
	ActivationGate,
	AttachCategory,
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
	SlashCommand,
	ToolItem,
	ToolUseBlock,
} from "./types";
