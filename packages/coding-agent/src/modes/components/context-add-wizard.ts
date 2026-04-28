// biome-ignore lint/correctness/noUnusedImports: used in Task 2
import { Container, Input, matchesKey, Spacer, Text, TruncatedText } from "@f5xc-salesdemos/pi-tui";
// biome-ignore lint/correctness/noUnusedImports: used in Task 2
import type { F5XCContext } from "../../services/f5xc-context";
// biome-ignore lint/correctness/noUnusedImports: used in Task 2
import { deriveTenantFromUrl } from "../../services/f5xc-env";
// biome-ignore lint/correctness/noUnusedImports: used in Task 2
import { theme } from "../theme/theme";
// biome-ignore lint/correctness/noUnusedImports: used in Task 2
import { matchesAppInterrupt } from "../utils/keybinding-matchers";
// biome-ignore lint/correctness/noUnusedImports: used in Task 2
import { DynamicBorder } from "./dynamic-border";

const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export function validateWizardUrl(url: string): string | null {
	if (!url.trim()) return "URL is required";
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "https:") return "URL must use HTTPS";
		return null;
	} catch {
		return "Invalid URL format";
	}
}

export function validateWizardName(name: string): string | null {
	if (!name.trim()) return "Name is required";
	if (!NAME_PATTERN.test(name)) return "Name must be 1-64 characters: letters, digits, hyphens, underscores";
	return null;
}
