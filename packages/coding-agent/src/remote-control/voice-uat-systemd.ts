export interface SystemdVoiceReplacement {
	unit: string;
	properties(): Promise<Record<string, string>>;
	resolveExecutable(path: string): Promise<string>;
	command(argv: string[]): Promise<string>;
	wait(milliseconds: number): Promise<void>;
}

/**
 * Gracefully quiesce the exact running artifact before asking systemd to
 * start the replacement. ExecStop runs after systemd has already signalled
 * the main process, so it cannot provide this ordering for restart jobs.
 */
export async function replaceSystemdVoiceService(host: SystemdVoiceReplacement): Promise<void> {
	let properties = await host.properties();
	if (properties.ActiveState !== "inactive" && properties.ActiveState !== "failed") {
		const pid = Number(properties.MainPID);
		if (!Number.isInteger(pid) || pid < 1)
			throw new Error(`Cannot quiesce ${host.unit}: invalid MainPID ${properties.MainPID ?? "missing"}`);
		const executable = await host.resolveExecutable(`/proc/${pid}/exe`);
		await host.command([executable, "remote-control", "quiesce"]);
		for (let attempt = 0; attempt < 20; attempt++) {
			properties = await host.properties();
			if (properties.ActiveState === "inactive" || properties.ActiveState === "failed") break;
			if (attempt < 19) await host.wait(500);
		}
		if (properties.ActiveState !== "inactive" && properties.ActiveState !== "failed")
			throw new Error(
				`Cannot replace ${host.unit}: graceful quiesce left it ${properties.ActiveState ?? "unknown"}/${properties.SubState ?? "unknown"}`,
			);
	}
	await host.command(["systemctl", "--user", "start", host.unit]);
}
