import { type Component, type Container, TERMINAL, Text, visibleWidth, wrapTextWithAnsi } from "@f5-sales-demo/pi-tui";
import { recoveryUrlHyperlink, safeRecoveryUrl } from "../../tui/hyperlink";
import { theme } from "../theme/theme";

type AuthLinkContainer = Pick<Container, "addChild">;

/** Wrap plain glyphs first, then attach the complete target to each physical row. */
class RecoveryLinkText implements Component {
	constructor(
		private readonly url: string,
		private readonly label: string,
	) {}
	invalidate(): void {}

	render(width: number): string[] {
		const margin = width >= 3 ? " " : "";
		const contentWidth = Math.max(1, width - margin.length * 2);
		return wrapTextWithAnsi(this.label, contentWidth).map(segment => {
			const linked = theme.fg("accent", recoveryUrlHyperlink(this.url, segment));
			const line = `${margin}${linked}${margin}`;
			return line + " ".repeat(Math.max(0, width - visibleWidth(line)));
		});
	}
}

export interface AuthLinkPresenterOptions {
	platform?: NodeJS.Platform;
}

/** Present a browser authorization target with exact links on every wrapped row. */
export function presentAuthLink(
	container: AuthLinkContainer,
	url: string,
	options: AuthLinkPresenterOptions = {},
): void {
	const target = safeRecoveryUrl(url);
	if (!target) {
		container.addChild(new Text(theme.fg("warning", "Sign-in URL unavailable: invalid HTTP(S) target."), 1, 0));
		return;
	}
	const platform = options.platform ?? process.platform;
	const clickHint = platform === "darwin" ? "Cmd+click to open" : "Ctrl+click to open";
	const hyperlink = recoveryUrlHyperlink(target, "Open sign-in page");
	container.addChild(new RecoveryLinkText(target, "Open sign-in page"));
	container.addChild(new Text(theme.fg("dim", `(${clickHint})`), 1, 0));
	if (!TERMINAL.hyperlinks || hyperlink === "Open sign-in page") {
		container.addChild(new RecoveryLinkText(target, target));
		container.addChild(new Text(theme.fg("dim", "The full URL is visible above for manual recovery."), 1, 0));
	}
}

/** Render device verification details so they remain usable without hyperlink or clipboard support. */
export function presentDeviceCode(container: AuthLinkContainer, url: string, userCode: string): void {
	const target = safeRecoveryUrl(url);
	if (target) container.addChild(new RecoveryLinkText(target, target));
	else
		container.addChild(new Text(theme.fg("warning", "Verification URL unavailable: invalid HTTP(S) target."), 1, 0));
	container.addChild(new Text(theme.fg("warning", `One-time code: ${theme.bold(userCode)}`), 1, 0));
	container.addChild(
		new Text(theme.fg("dim", "Press c at the prompt to copy; the code remains readable above."), 1, 0),
	);
}
