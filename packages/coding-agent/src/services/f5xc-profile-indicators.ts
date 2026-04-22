import { theme } from "../modes/theme/theme";

export type StatusCategory = "connected" | "error" | "warning" | "unknown";

export function formatStatusIcon(status: StatusCategory): string {
	switch (status) {
		case "connected":
			return theme.fg("success", "●");
		case "error":
			return theme.fg("error", "○");
		case "warning":
			return theme.fg("warning", "⚠");
		case "unknown":
			return theme.fg("dim", "○");
	}
}
