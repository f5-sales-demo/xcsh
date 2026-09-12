import { emergencyTerminalRestore } from "@f5-sales-demo/pi-tui";
import { postmortem } from "@f5-sales-demo/pi-utils";

let backgroundRestoreSuppressed = false;

/**
 * Background mode restores the terminal before yielding to the shell. Its
 * later headless exit must not write terminal control sequences from a
 * background process group, which would make the shell stop it with SIGTTOU.
 */
export function suppressTerminalRestoreForBackgroundShutdown(): void {
	backgroundRestoreSuppressed = true;
}

postmortem.register("terminal-restore", () => {
	if (!backgroundRestoreSuppressed) emergencyTerminalRestore();
});
