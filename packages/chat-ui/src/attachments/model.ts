/**
 * The typed, multi-attachment model for the chat composer — the single shared
 * home for what was previously DUPLICATED between the VS Code extension host and
 * its webview (and mirrored ad hoc elsewhere). Every attachment carries a
 * `content` string; the agent is text-only, so attachments serialize to labelled
 * text blocks prepended to the user's message on submit.
 *
 * Framework-free + host-agnostic: no React, no host globals. The HOST sources
 * attachments (file pickers, diagnostics, symbol search — all host-specific) and
 * feeds the resulting {@link Attachment} objects to the shared Composer via props;
 * this module owns only the shape, dedup/budget policy, and serialization.
 */

export type AttachmentKind = "file" | "folder" | "instructions" | "scm" | "problems" | "symbols" | "sessions" | "tools";

export interface BaseAttachment {
	/** Stable unique id for keys + removal. */
	id: string;
	kind: AttachmentKind;
	/** Human-readable chip label. */
	label: string;
	/** Identity used to reject duplicate attachments. */
	dedupKey: string;
	/** Text folded into the next prompt. */
	content: string;
}

export interface FileAttachment extends BaseAttachment {
	kind: "file";
	path: string;
}
export interface FolderAttachment extends BaseAttachment {
	kind: "folder";
	path: string;
}
export interface InstructionsAttachment extends BaseAttachment {
	kind: "instructions";
	sourcePath: string;
}
export interface ScmAttachment extends BaseAttachment {
	kind: "scm";
	repoRoot: string;
}
export interface ProblemsAttachment extends BaseAttachment {
	kind: "problems";
	/** 'workspace' or a file path. */
	scope: string;
}
export interface SymbolsAttachment extends BaseAttachment {
	kind: "symbols";
	query: string;
}
export interface SessionsAttachment extends BaseAttachment {
	kind: "sessions";
	sessionId: string;
}
export interface ToolsAttachment extends BaseAttachment {
	kind: "tools";
	toolNames: string[];
}

export type Attachment =
	| FileAttachment
	| FolderAttachment
	| InstructionsAttachment
	| ScmAttachment
	| ProblemsAttachment
	| SymbolsAttachment
	| SessionsAttachment
	| ToolsAttachment;

/** Combined attachment content budget per turn (512 KB). */
export const MAX_ATTACHMENT_BYTES = 512 * 1024;

const KIND_LABEL: Record<AttachmentKind, string> = {
	file: "File",
	folder: "Folder",
	instructions: "Instructions",
	scm: "Source Control",
	problems: "Problems",
	symbols: "Symbols",
	sessions: "Session",
	tools: "Tools",
};

/** UTF-8 byte length (matches a host's `Buffer.byteLength(s, "utf8")`). */
export function byteLength(s: string): number {
	return new TextEncoder().encode(s).length;
}

/** Render one attachment as a labelled text block for the prompt. */
export function serializeAttachment(a: Attachment): string {
	return `[${KIND_LABEL[a.kind]}: ${a.label}]\n\n${a.content}`;
}

/** Join all attachments into the prefix prepended to the user's message. */
export function serializeAttachments(list: Attachment[]): string {
	return list.map(serializeAttachment).join("\n\n");
}

/** Outcome of {@link addAttachment}. */
export interface AddResult {
	list: Attachment[];
	added: boolean;
	reason?: "duplicate" | "budget";
}

/**
 * Return a new list with `incoming` appended, unless it duplicates an existing
 * `dedupKey` or would push the combined content past {@link MAX_ATTACHMENT_BYTES}.
 * On rejection the original list reference is returned unchanged.
 */
export function addAttachment(list: Attachment[], incoming: Attachment): AddResult {
	if (list.some(a => a.dedupKey === incoming.dedupKey)) {
		return { list, added: false, reason: "duplicate" };
	}
	const currentBytes = list.reduce((sum, a) => sum + byteLength(a.content), 0);
	if (currentBytes + byteLength(incoming.content) > MAX_ATTACHMENT_BYTES) {
		return { list, added: false, reason: "budget" };
	}
	return { list: [...list, incoming], added: true };
}
