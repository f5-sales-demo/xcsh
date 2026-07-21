/**
 * The top header bar (NEW), giving Claude-for-Office structural parity in our
 * terminal aesthetic. Right-aligned icon-button controls, in order:
 *   history (≡, dropdown of past chats) · new-chat (✎, action) · more (⋯, dropdown)
 * Callbacks + menu items are props — headless. Menu buttons use terminal glyphs.
 */
import type { MenuItem } from "../types";
import { useMenu } from "./useMenu";

export interface HeaderBarProps {
	title?: string;
	onNewChat: () => void;
	historyItems?: MenuItem[];
	onHistorySelect?: (id: string) => void;
	moreItems?: MenuItem[];
	onMoreSelect?: (id: string) => void;
}

function MenuButton({
	glyph,
	title,
	items,
	onSelect,
}: {
	glyph: string;
	title: string;
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
				title={title}
				aria-label={title}
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={toggle}
			>
				{glyph}
			</button>
			{open && (
				<div className="menu menu-down menu-right" role="menu" ref={menuRef}>
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
	historyItems,
	onHistorySelect,
	moreItems,
	onMoreSelect,
}: HeaderBarProps) {
	return (
		<div className="header">
			{title && <span className="header-title">{title}</span>}
			<span className="header-spacer" />
			{historyItems && <MenuButton glyph="≡" title="Chat history" items={historyItems} onSelect={onHistorySelect} />}
			<button type="button" className="header-btn" title="New chat" aria-label="New chat" onClick={onNewChat}>
				✎
			</button>
			{moreItems && <MenuButton glyph="⋯" title="More options" items={moreItems} onSelect={onMoreSelect} />}
		</div>
	);
}
