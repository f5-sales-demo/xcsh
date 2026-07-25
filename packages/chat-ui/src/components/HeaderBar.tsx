/**
 * The top header bar, giving Claude-for-Office structural parity in our terminal
 * aesthetic. Right-aligned icon-button controls, in order:
 *   history (clock, dropdown of past chats) · new-chat (⊕, action) · more (⋮, dropdown)
 * Callbacks + menu items are props — headless.
 *
 * This row is PINNED (a sibling of the scrollport, not inside it). The brand block
 * scrolls instead — it is passed to `Transcript.brand`.
 *
 * Each control labels itself via `aria-label` + `data-tip`, never `title`: the CSS
 * tooltip is driven by `data-tip`, and keeping `title` too would stack a second
 * native tooltip on top of it.
 */
import type { MenuItem, ReactNode } from "../types";
import { HistoryIcon, MoreIcon, NewChatIcon } from "./icons";
import { useMenu } from "./useMenu";

export interface HeaderBarProps {
	title?: string;
	onNewChat: () => void;
	/** Gate the new-chat action (e.g. nothing to reset yet). Default: enabled. */
	canNewChat?: boolean;
	historyItems?: MenuItem[];
	onHistorySelect?: (id: string) => void;
	/** Caption above the history entries — e.g. "This session", so a host whose
	 *  history does not survive a reload cannot be mistaken for one that does. */
	historyHeader?: string;
	moreItems?: MenuItem[];
	onMoreSelect?: (id: string) => void;
}

function MenuButton({
	icon,
	label,
	header,
	items,
	onSelect,
}: {
	icon: ReactNode;
	label: string;
	header?: string;
	items: MenuItem[];
	onSelect?: (id: string) => void;
}) {
	const { open, setOpen, toggle, menuRef, triggerRef } = useMenu();

	return (
		<div className="header-menuwrap">
			<button
				ref={triggerRef}
				type="button"
				className="header-btn"
				data-tip={label}
				aria-label={label}
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={toggle}
			>
				{icon}
			</button>
			{open && (
				<div className="menu menu-down menu-right" role="menu" ref={menuRef}>
					{header && <div className="menu-header">{header}</div>}
					{items.length === 0 ? (
						<div className="menu-header">Empty</div>
					) : (
						items.map(item => (
							<button
								key={item.id}
								type="button"
								role="menuitem"
								className="menu-item"
								disabled={item.disabled}
								onClick={() => {
									onSelect?.(item.id);
									setOpen(false);
								}}
							>
								<span>{item.label}</span>
							</button>
						))
					)}
				</div>
			)}
		</div>
	);
}

export function HeaderBar({
	title,
	onNewChat,
	canNewChat = true,
	historyItems,
	onHistorySelect,
	historyHeader,
	moreItems,
	onMoreSelect,
}: HeaderBarProps) {
	return (
		<div className="header">
			{title && <span className="header-title">{title}</span>}
			<span className="header-spacer" />
			{historyItems && (
				<MenuButton
					icon={<HistoryIcon />}
					label="Chat history"
					header={historyHeader}
					items={historyItems}
					onSelect={onHistorySelect}
				/>
			)}
			<button
				type="button"
				className="header-btn"
				data-tip="New chat"
				aria-label="New chat"
				disabled={!canNewChat}
				onClick={onNewChat}
			>
				<NewChatIcon />
			</button>
			{moreItems && (
				<MenuButton icon={<MoreIcon />} label="More options" items={moreItems} onSelect={onMoreSelect} />
			)}
		</div>
	);
}
