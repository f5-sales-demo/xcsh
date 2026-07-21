/**
 * The composer's "add context" button + category dropdown — the shared, headless
 * parity of a chat attachment picker. Self-contained like {@link ModelSelector}:
 * it renders the "+" trigger and the popup. Categories are host-provided
 * ({@link AttachCategory}); picking one fires `onSelect(id)` and the host does the
 * actual sourcing (file picker / diagnostics / symbol search). Keyboard/focus a11y
 * comes from {@link useMenu}.
 */
import type { AttachCategory } from "../types";
import { PlusIcon } from "./icons";
import { useMenu } from "./useMenu";

export interface AttachMenuProps {
	categories: AttachCategory[];
	onSelect: (id: string) => void;
	disabled?: boolean;
}

export function AttachMenu({ categories, onSelect, disabled }: AttachMenuProps) {
	const { open, setOpen, toggle, menuRef, triggerRef } = useMenu();
	return (
		<div className="attach-menu" style={{ position: "relative" }}>
			{open && (
				<div className="menu menu-up menu-left" role="menu" ref={menuRef}>
					{categories.length === 0 ? (
						<div className="menu-header">No sources</div>
					) : (
						categories.map(cat => (
							<button
								key={cat.id}
								type="button"
								role="menuitem"
								className="menu-item"
								onClick={() => {
									onSelect(cat.id);
									setOpen(false);
								}}
							>
								<span>{cat.label}</span>
								{cat.description && <span className="menu-item-desc">{cat.description}</span>}
							</button>
						))
					)}
				</div>
			)}
			<button
				ref={triggerRef}
				type="button"
				className="footer-btn"
				title="Add context"
				aria-label="Add context"
				aria-haspopup="menu"
				aria-expanded={open}
				disabled={disabled}
				onClick={toggle}
			>
				<PlusIcon />
			</button>
		</div>
	);
}
