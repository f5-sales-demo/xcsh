export interface SystemdVoiceReplacement {
	unit: string;
	quiesceExecutable: string;
	properties(): Promise<Record<string, string>>;
	command(argv: string[]): Promise<string>;
	wait(milliseconds: number): Promise<void>;
}

export interface SignalEmitter {
	on(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
	off(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

/** Restore deployment state before surfacing an interrupt to the caller. */
export async function withSignalSafeRecovery<T>(
	operation: (signal: AbortSignal) => Promise<T>,
	recover: () => Promise<void>,
	signals: SignalEmitter = process,
): Promise<T> {
	const abort = new AbortController();
	let interruptedBy: "SIGINT" | "SIGTERM" | undefined;
	const handler = (signal: "SIGINT" | "SIGTERM") => {
		interruptedBy ??= signal;
		abort.abort(new Error(`Deployment interrupted by ${signal}`));
	};
	const interrupt = () => handler("SIGINT");
	const terminate = () => handler("SIGTERM");
	signals.on("SIGINT", interrupt);
	signals.on("SIGTERM", terminate);
	try {
		let result: T | undefined;
		try {
			result = await operation(abort.signal);
		} catch (error) {
			if (!interruptedBy) throw error;
		}
		if (!interruptedBy) return result as T;
		try {
			await recover();
		} catch (recovery) {
			throw new AggregateError([recovery], `Deployment interrupted by ${interruptedBy}; baseline recovery failed`);
		}
		throw new Error(`Deployment interrupted by ${interruptedBy}; baseline restored`);
	} finally {
		signals.off("SIGINT", interrupt);
		signals.off("SIGTERM", terminate);
	}
}

/**
 * Gracefully quiesce the exact running artifact before asking systemd to
 * start the replacement. ExecStop runs after systemd has already signalled
 * the main process, so it cannot provide this ordering for restart jobs.
 */
export async function replaceSystemdVoiceService(host: SystemdVoiceReplacement): Promise<void> {
	let properties = await host.properties();
	if (properties.ActiveState !== "inactive" && properties.ActiveState !== "failed") {
		for (let attempt = 0; attempt < 20; attempt++) {
			const pid = Number(properties.MainPID);
			if (Number.isInteger(pid) && pid >= 1) break;
			if (properties.ActiveState === "inactive" || properties.ActiveState === "failed") break;
			if (attempt < 19) {
				await host.wait(500);
				properties = await host.properties();
			}
		}
		if (properties.ActiveState !== "inactive" && properties.ActiveState !== "failed") {
			const pid = Number(properties.MainPID);
			if (!Number.isInteger(pid) || pid < 1)
				throw new Error(`Cannot quiesce ${host.unit}: invalid MainPID ${properties.MainPID ?? "missing"}`);
			await host.command([host.quiesceExecutable, "remote-control", "quiesce"]);
		}
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
