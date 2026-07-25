/**
 * Shared open/close + keyboard behavior for the library's popup menus
 * (ModeToggle / ModelSelector / HeaderBar), factored once so every menu is
 * consistent and accessible:
 *
 *  - Outside-click closes the menu (a click on any other menu's trigger closes
 *    this one, so opening one menu closes the others).
 *  - On open, focus moves to the first enabled `role="menuitem"`.
 *  - ArrowDown / ArrowUp cycle items; Home / End jump to first / last.
 *  - Escape closes the menu AND returns focus to the trigger.
 *
 * The consumer spreads `menuRef` on the `role="menu"` element and `triggerRef`
 * on the trigger button. Framework-neutral (plain DOM APIs) so it works under
 * React and preact/compat alike.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * What {@link useMenu} returns, DERIVED rather than hand-written.
 *
 * The ref types must be spelled by whichever runtime is compiling this source:
 * React 19's `useRef<T>(null)` yields `RefObject<T | null>`, while preact/compat's
 * yields its own `RefObject<T>` — and preact's JSX `ref` prop accepts only the
 * latter. Naming either one explicitly typechecks in one host and breaks the
 * other (a hand-written `RefObject<T | null>` broke the Chrome extension, which
 * vendors this source and aliases react → preact/compat). Inference sidesteps the
 * whole problem: each host derives the refs its own JSX already accepts.
 */
export type UseMenuResult = ReturnType<typeof useMenu>;

export function useMenu() {
	const [open, setOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const toggle = useCallback(() => setOpen(o => !o), []);

	// Outside-click closes (ignoring clicks within this menu or its trigger).
	useEffect(() => {
		if (!open) return;
		const onDocClick = (e: MouseEvent) => {
			const target = e.target as Node;
			if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
			setOpen(false);
		};
		document.addEventListener("click", onDocClick);
		return () => document.removeEventListener("click", onDocClick);
	}, [open]);

	// Roving focus + Escape-returns-focus, scoped to the open menu.
	useEffect(() => {
		if (!open) return;
		const menu = menuRef.current;
		if (!menu) return;
		const items = (): HTMLElement[] =>
			Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));

		items()[0]?.focus();

		const onKey = (e: KeyboardEvent) => {
			const list = items();
			if (list.length === 0 && e.key !== "Escape") return;
			const idx = list.indexOf(document.activeElement as HTMLElement);
			switch (e.key) {
				case "ArrowDown":
					e.preventDefault();
					list[(idx + 1) % list.length]?.focus();
					break;
				case "ArrowUp":
					e.preventDefault();
					list[(idx - 1 + list.length) % list.length]?.focus();
					break;
				case "Home":
					e.preventDefault();
					list[0]?.focus();
					break;
				case "End":
					e.preventDefault();
					list[list.length - 1]?.focus();
					break;
				case "Escape":
					e.preventDefault();
					setOpen(false);
					triggerRef.current?.focus();
					break;
			}
		};
		menu.addEventListener("keydown", onKey);
		return () => menu.removeEventListener("keydown", onKey);
	}, [open]);

	return {
		open,
		setOpen,
		toggle,
		menuRef,
		triggerRef,
	};
}
