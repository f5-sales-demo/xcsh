export type StatusCategory = "connected" | "error" | "warning" | "unknown";

// Checkbox emoji indicators shared by the welcome screen and the /context table.
// Target terminal: iTerm2 + Nerd Fonts, where emoji presentation and width (2 cells)
// are consistent. Emoji carry their own coloring — no theme.fg wrapping needed.
export function formatStatusIcon(status: StatusCategory): string {
	switch (status) {
		case "connected":
			return "✅";
		case "error":
			return "❌";
		case "warning":
			return "⚠️";
		case "unknown":
			return "❓";
	}
}
