/**
 * ChatPanel — the streaming chat shell, rendered entirely with the shared
 * `@f5-sales-demo/xcsh-chat-ui` terminal components (Fluent is gone).
 *
 * It owns no transport/protocol logic: {@link useChatSession} folds the injected
 * transport's stream into turns, {@link turnsToMessages} projects those onto the
 * shared `ChatMessage[]`, and the shared `Transcript`/`Composer` render them. A
 * clicked starter pill PREFILLS the composer (via the Phase-2 `ComposerHandle`
 * seam) for the user to edit and send — matching Claude-for-Office, not
 * send-immediately.
 *
 * Browser-safe: no node:* imports, no Office.js. The transport is injected.
 */
import {
	type AttachCategory,
	type Attachment,
	addAttachment,
	Composer,
	type ComposerHandle,
	EmptyState,
	F5Logo,
	HeaderBar,
	type ImageAttachment,
	isImageAttachment,
	type MenuItem,
	type SkillPill,
	Transcript,
} from "@f5-sales-demo/xcsh-chat-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ChatImageMsg, Transport } from "../core";
import { turnsToMessages } from "./adapt";
import { useChatSession } from "./useChatSession";

/** The composer `+` menu photo category (always present). File/folder context
 *  categories always show; a "Skills" category is appended only when the engine
 *  reports loaded skills. */
const IMAGE_CATEGORY: AttachCategory = {
	id: "image",
	label: "Add files or photos",
	description: "Attach a photo or image",
};
const FILE_CATEGORY: AttachCategory = { id: "file", label: "Add a file", description: "Pick a local file as context" };
const FOLDER_CATEGORY: AttachCategory = {
	id: "folder",
	label: "Add a folder",
	description: "Pick a local folder as context",
};
const SKILLS_CATEGORY: AttachCategory = { id: "skills", label: "Skills", description: "Run a workspace skill" };
/** A toggle category: enables the active model API's server-side web search. */
const WEB_SEARCH_CATEGORY = { id: "web_search", label: "Search the web", toggle: true } as const;

/** Last path segment, for a compact chip label (handles trailing-slash-free paths). */
function baseName(p: string): string {
	const parts = p.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? p;
}

/** Image types the vision model accepts (Anthropic: png/jpeg/gif/webp). */
const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

/** Read a picked file into an {@link ImageAttachment} (base64, no data-URL prefix).
 *  Resolves null on read error or empty data so a bad file is skipped, not crashed. */
function readImageAttachment(file: File): Promise<ImageAttachment | null> {
	return new Promise(resolve => {
		const reader = new FileReader();
		reader.onerror = () => resolve(null);
		reader.onload = () => {
			const result = typeof reader.result === "string" ? reader.result : "";
			const comma = result.indexOf(",");
			const data = comma >= 0 ? result.slice(comma + 1) : "";
			if (!data) {
				resolve(null);
				return;
			}
			const dedupKey = `image:${file.name}:${file.size}`;
			resolve({
				id: dedupKey,
				kind: "image",
				label: file.name,
				dedupKey,
				content: "", // images ride chat_request.images, never the prompt text
				mimeType: file.type || "image/png",
				data,
			});
		};
		reader.readAsDataURL(file);
	});
}

export interface ChatPanelProps {
	transport: Transport;
	/**
	 * Point xcsh's provider at the saved gateway before chat is enabled. Runs after
	 * connect(); a rejection gates chat and shows the config-error recovery view.
	 */
	provision?: () => Promise<void>;
	/** Fired once after provisioning succeeds — e.g. to advertise host tools. */
	onConnected?: () => void;
	/** Select an engine model; resolves with the acknowledged model id. */
	selectModel?: (model: string) => Promise<string>;
	/** Recovery action for a configure failure — reopens the gateway config form. */
	onReconfigure?: () => void;
	/**
	 * Fired once per error episode when a chat turn fails because the configured
	 * provider rejected the configured credential (`provider-auth`),
	 * so the host can auto-open the gateway config. Distinct from `onReconfigure`
	 * (a connect-time `configure` rejection).
	 */
	onProviderConfigError?: () => void;
}

/** Host-agnostic starter prompts; picking one prefills (not sends) the composer. */
const STARTERS: readonly (SkillPill & { text: string })[] = [
	{ id: "explain", label: "Explain the selection", hint: "Prefill a prompt", text: "Explain the current selection." },
	{
		id: "improve",
		label: "Improve the wording",
		hint: "Prefill a prompt",
		text: "Improve the wording of the selected text.",
	},
	{ id: "summarize", label: "Summarize", hint: "Prefill a prompt", text: "Summarize this document." },
];

/**
 * Brand-mark size. Until #2414 `.f5-mark` declared `width/height:auto`, which
 * outranks the width/height attributes F5Logo emits from `size` — so every mark
 * rendered at the PNG's intrinsic 128px and this prop was dead. That 128px is the
 * appearance that shipped and was signed off, so it is now stated deliberately
 * rather than inherited by accident.
 */
const BRAND_MARK_SIZE = 128;

/** The F5 brand block. Rendered INSIDE the transcript scrollport (via
 *  `Transcript.brand`) so it scrolls away with the conversation instead of sitting
 *  in a pinned band — the pinned row is the {@link HeaderBar} control row. */
function Brand() {
	return (
		<div className="brand-block">
			<F5Logo variant="mark" size={BRAND_MARK_SIZE} />
			<span className="brand-title">xcsh</span>
		</div>
	);
}

/** Composer placeholder while the gateway connection is being established. */
const PROVISIONING_PLACEHOLDER: Record<string, string> = {
	connecting: "Connecting to xcsh…",
	configuring: "Configuring gateway…",
};

/** Sentinel history-menu id for "leave the archive, back to the live chat". Cannot
 *  collide with a real entry id (those are the engine's `conv-N` boundaries). */
const LIVE_CHAT_ITEM = "__current__";

export function ChatPanel({
	transport,
	provision,
	onConnected,
	selectModel: selectEngineModel,
	onReconfigure,
	onProviderConfigError,
}: ChatPanelProps) {
	const {
		turns,
		send,
		stop,
		retry,
		newChat,
		history,
		viewingId,
		viewHistory,
		exitHistory,
		status,
		reason,
		provisioning,
		provisionError,
		skills,
		slashCommands,
		models,
		model,
		selectModel,
		pickPath,
	} = useChatSession(transport, { provision, onConnected, selectModel: selectEngineModel });
	const composerRef = useRef<ComposerHandle>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	// Photo/image attachments staged for the next send. The host owns this state and
	// clears it in onSend (per the shared Composer's host-maps-its-own-state contract).
	const [attachments, setAttachments] = useState<Attachment[]>([]);
	// "Search the web" toggle — ON by default (the gateway runs the active provider's
	// native search, so current-events answers work out of the box) and sticky until flipped off.
	const [webSearch, setWebSearch] = useState(true);

	const messages = useMemo(() => turnsToMessages({ turns, status, reason }), [turns, status, reason]);
	const streaming = status === "streaming";

	// The "+" categories: photos + file/folder context + the web-search toggle always;
	// Skills only when the engine reports skills.
	const attachCategories = useMemo(() => {
		const search: AttachCategory = { ...WEB_SEARCH_CATEGORY, active: webSearch };
		const base = [IMAGE_CATEGORY, FILE_CATEGORY, FOLDER_CATEGORY, search];
		return skills.length > 0 ? [...base, SKILLS_CATEGORY] : base;
	}, [skills.length, webSearch]);

	// `+` category pick:
	//  - "image" opens the hidden file input (photos → base64 vision blocks).
	//  - "file"/"folder" open a native OS picker on the bridge; the chosen absolute
	//    path becomes a path-only context chip (empty content → never serialized to
	//    text; it rides chat_request.contextPaths and is sandbox-granted engine-side).
	//  - "skills" is handled inside the Composer (opens the Skills submenu).
	const handleRequestAttachment = useCallback(
		async (categoryId: string) => {
			if (categoryId === "image") {
				fileInputRef.current?.click();
				return;
			}
			if (categoryId === "web_search") {
				setWebSearch(v => !v); // flip the sticky toggle; the menu stays open to show it
				return;
			}
			if (categoryId === "file" || categoryId === "folder") {
				const res = await pickPath(categoryId);
				if (!res.path) return; // canceled / unsupported → nothing to add
				const path = res.path;
				const dedupKey = `${categoryId}:${path}`;
				const attachment = {
					id: dedupKey,
					kind: categoryId,
					label: baseName(path),
					dedupKey,
					content: "", // path-only reference — rides contextPaths, not the prompt text
					path,
				} as Attachment;
				setAttachments(prev => addAttachment(prev, attachment).list);
			}
		},
		[pickPath],
	);

	// The header's clock menu: this session's banked chats, newest first, plus a way
	// back to the live one while reading an archive. Omitted entirely when there is
	// nothing to show, so the control never appears as a dead button on first run.
	// ALWAYS rendered, even with nothing banked: the menu then reads "This session ·
	// Empty", which is honest, whereas a control that materialises later reads as
	// broken (#2415 — the reference pane always shows it).
	const historyItems = useMemo<MenuItem[]>(() => {
		const banked: MenuItem[] = history.map(h => ({
			id: h.id,
			label: h.title,
			// The one already on screen isn't a destination.
			disabled: h.id === viewingId,
		}));
		return viewingId ? [{ id: LIVE_CHAT_ITEM, label: "Current chat" }, ...banked] : banked;
	}, [history, viewingId]);

	const handleHistorySelect = useCallback(
		(id: string) => {
			if (id === LIVE_CHAT_ITEM) exitHistory();
			else viewHistory(id);
		},
		[exitHistory, viewHistory],
	);

	// The header's "⋯" menu. It carries gateway Settings, which used to be a floating
	// button the shared GatewayGate rendered — that stacked a second right-aligned row
	// that collided with Office's native ⓘ. Omitted entirely (rather than rendered
	// inert) when the host wired no reconfigure action, so the menu is never empty.
	const moreItems = useMemo<MenuItem[] | undefined>(
		() => (onReconfigure ? [{ id: "settings", label: "Settings" }] : undefined),
		[onReconfigure],
	);
	const handleMoreSelect = useCallback(
		(id: string) => {
			if (id === "settings") onReconfigure?.();
		},
		[onReconfigure],
	);

	// Picking a skill prefills the composer with `/name ` (Claude idiom) for the user
	// to add input and send; the engine treats a leading `/skill` as a skill invocation.
	const handleSkillSelect = useCallback((name: string) => {
		composerRef.current?.setText(`/${name} `);
	}, []);

	/** Prefill rather than send: a command usually takes arguments (a deal or account
	 *  name), and the engine substitutes them into the template's `$ARGUMENTS`. */
	const handleSlashSelect = useCallback((command: string) => {
		composerRef.current?.setText(`${command} `);
	}, []);

	/** The chat-ui menu wants `{command, label, description}`; the wire carries
	 *  `{name, description}`. The leading slash belongs to the UI, not the engine. */
	const slashMenuItems = useMemo(
		() => slashCommands.map(c => ({ command: `/${c.name}`, label: c.name, description: c.description })),
		[slashCommands],
	);

	const handleFiles = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(e.target.files ?? []);
		// Allow re-picking the same file later by clearing the input value.
		e.target.value = "";
		const read = await Promise.all(files.map(readImageAttachment));
		setAttachments(prev => {
			let next = prev;
			for (const img of read) {
				if (img) next = addAttachment(next, img).list;
			}
			return next;
		});
	}, []);

	const handleRemoveAttachment = useCallback((id: string) => {
		setAttachments(prev => prev.filter(a => a.id !== id));
	}, []);

	const handleSend = useCallback(
		(text: string) => {
			const images: ChatImageMsg[] = attachments
				.filter(isImageAttachment)
				.map(a => ({ data: a.data, mimeType: a.mimeType }));
			// File/folder path-refs → contextPaths (engine grants them to the sandbox).
			const contextPaths = attachments
				.filter((a): a is Attachment & { path: string } => a.kind === "file" || a.kind === "folder")
				.map(a => a.path);
			const opts: { images?: ChatImageMsg[]; contextPaths?: string[]; webSearch?: boolean } = {};
			if (images.length > 0) opts.images = images;
			if (contextPaths.length > 0) opts.contextPaths = contextPaths;
			if (webSearch) opts.webSearch = true;
			send(text, Object.keys(opts).length > 0 ? opts : undefined);
			setAttachments([]);
		},
		[attachments, webSearch, send],
	);

	// Auto-open the gateway config when a turn fails because the configured provider
	// rejected its credential. Fire once per episode; an ordinary provider-4xx is
	// a request problem and must stay in chat rather than implying the token is bad.
	// a subsequent retry (status leaves 'error') re-arms it. Never while reading an
	// archive: that failure is history, and popping the form over it is a false alarm.
	const providerRejected = !viewingId && status === "error" && reason === "provider-auth";
	const promptedRef = useRef(false);
	useEffect(() => {
		if (providerRejected && !promptedRef.current) {
			promptedRef.current = true;
			onProviderConfigError?.();
		} else if (!providerRejected) {
			promptedRef.current = false;
		}
	}, [providerRejected, onProviderConfigError]);

	// Chat is gated until provisioning resolves so a turn can't race `configure_ack`.
	const ready = provisioning === "ready";

	// The pinned control row, rendered in EVERY branch. The error and onboarding
	// branches need it too: it now carries the only route to gateway config (the
	// shared GatewayGate no longer renders a floating Settings button), and those
	// are exactly the states where the user needs to fix the gateway. They pass a
	// `title` because they don't render the transcript, whose scrolling brand block
	// otherwise carries the wordmark.
	//
	// New chat stays available WHILE streaming — it aborts the in-flight turn
	// (chat_stop) and resets, so a wedged turn is recoverable without a restart.
	const controlRow = (title?: string) => (
		<HeaderBar
			title={title}
			onNewChat={newChat}
			historyItems={historyItems}
			onHistorySelect={handleHistorySelect}
			// Say the quiet part out loud: these chats live only in this pane session.
			historyHeader="This session"
			moreItems={moreItems}
			onMoreSelect={handleMoreSelect}
		/>
	);

	// A rejected provider `configure` is a non-silent, recoverable state: show the
	// reason and a Reconfigure action instead of a chat that would silently talk to
	// xcsh's baked-in default provider. #2134.
	if (provisioning === "error") {
		return (
			<>
				{controlRow("xcsh")}
				<div className="gateway-config-error" role="alert">
					<p className="gateway-config-error-title">Couldn't configure the gateway.</p>
					<p className="gateway-config-error-detail">
						{provisionError ?? "The provider configuration was rejected."}
					</p>
					<button type="button" className="msg-retry" onClick={() => onReconfigure?.()}>
						Reconfigure
					</button>
				</div>
			</>
		);
	}

	// First-run with no bridge: the pane loaded (cloud-hosted for AppSource) but
	// can't reach the local xcsh serve. Show a dedicated onboarding screen instead
	// of a confusing "Connection to the assistant was lost." error.
	const firstRunBridgeFailure = status === "error" && reason === "bridge-disconnected" && turns.length === 0;
	if (firstRunBridgeFailure) {
		return (
			<>
				{controlRow("xcsh")}
				<main className="onboarding">
					<F5Logo variant="mark" size={64} />
					<h2 className="onboarding-title">Install xcsh to get started</h2>
					<ol className="onboarding-steps">
						<li>
							Install: <code>brew install f5-sales-demo/tap/xcsh</code>
						</li>
						<li>
							Start the Office bridge: <code>xcsh office serve</code>
						</li>
						<li>Click Retry below to connect.</li>
					</ol>
					<button
						type="button"
						className="msg-retry"
						onClick={() => {
							// Reload the pane to re-trigger the transport connect.
							window.location.reload();
						}}
					>
						Retry
					</button>
				</main>
			</>
		);
	}

	// Starters: prefer the engine's real skills as a vertical /slash list (Claude's
	// shape, and every pill is a genuine invocation — the engine treats a leading
	// `/skill` as one). Falls back to the prose starters until the skills reply lands,
	// or for good if no skills are loaded, so the empty state is never bare.
	const emptyState =
		skills.length > 0 ? (
			<EmptyState
				heading="Get started with a skill:"
				pills={skills.map(s => ({ id: s.name, label: `/${s.name}`, hint: s.description }))}
				onPick={handleSkillSelect}
				stacked
				logo={false}
			/>
		) : (
			<EmptyState
				pills={STARTERS.map(({ id, label, hint }) => ({ id, label, hint }))}
				onPick={id => composerRef.current?.setText(STARTERS.find(s => s.id === id)?.text ?? "")}
				// The scrolling brand block already shows the F5 mark — don't duplicate it.
				logo={false}
			/>
		);

	// Reading a banked chat is read-only (the engine no longer holds its context, so a
	// reply would answer without it). The session refuses such a send outright; the
	// composer says so rather than looking broken, and no error row offers a Retry
	// that could only fire into a different conversation.
	const viewing = viewingId !== null;
	const composerPlaceholder = viewing
		? "Reading a past chat — reopen the current chat to reply"
		: ready
			? undefined
			: PROVISIONING_PLACEHOLDER[provisioning];

	return (
		<>
			{controlRow()}
			<Transcript
				messages={messages}
				streaming={streaming}
				// A server-side web search adds several seconds before the first token;
				// say so rather than showing a bare "Thinking…" that reads as a hang.
				thinkingLabel={webSearch ? "with web search" : undefined}
				onRetry={viewing ? undefined : () => retry()}
				brand={<Brand />}
				emptyState={emptyState}
			/>
			{/* Hidden file input backing the "+" → "Add files or photos" category —
			    Office.js exposes no native picker, so a task-pane WebView uses this. */}
			<input
				ref={fileInputRef}
				type="file"
				accept={IMAGE_ACCEPT}
				multiple
				style={{ display: "none" }}
				aria-hidden="true"
				tabIndex={-1}
				onChange={handleFiles}
			/>
			{/* No interaction-mode toggle: those modes are Chrome browser-automation
			    only. The Office pane fixes the mode to `educational` (see useChatSession). */}
			<Composer
				ref={composerRef}
				streaming={streaming}
				disabled={!ready || viewing}
				placeholder={composerPlaceholder}
				onSend={handleSend}
				onStop={stop}
				attachCategories={attachCategories}
				attachments={attachments}
				onRequestAttachment={handleRequestAttachment}
				onRemoveAttachment={handleRemoveAttachment}
				skills={skills}
				onSkillSelect={handleSkillSelect}
				slashCommands={slashMenuItems}
				onSlashSelect={handleSlashSelect}
				models={models}
				model={model ?? undefined}
				onModelChange={model ? id => void selectModel(id) : undefined}
			/>
		</>
	);
}
