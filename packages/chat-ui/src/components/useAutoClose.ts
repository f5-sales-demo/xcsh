/**
 * Close an open popup on an outside click or Escape. The trigger button must
 * `stopPropagation()` on its own click so opening doesn't immediately re-close.
 * Shared by ModeToggle / ModelSelector / HeaderBar (the VS Code dropdown idiom).
 */
import { useEffect } from "react";

export function useAutoClose(open: boolean, onClose: () => void): void {
	useEffect(() => {
		if (!open) return;
		const onDocClick = () => onClose();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("click", onDocClick);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("click", onDocClick);
			document.removeEventListener("keydown", onKey);
		};
	}, [open, onClose]);
}
