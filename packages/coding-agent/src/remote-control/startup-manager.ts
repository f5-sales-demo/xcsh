import { spawn } from "node:child_process";
import { chmod, mkdir, open, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

export const REMOTE_CONTROL_SERVICE = "xcsh-remote-control.service";

function systemdArgument(value: string): string {
	if (!value || /[\0\r\n]/.test(value)) throw new Error("Invalid systemd service argument");
	if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) return value.replaceAll("%", "%%");
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`;
}

export function renderSystemdUserService(input: { executablePath: string; arguments: string[] }): string {
	const command = [input.executablePath, ...input.arguments].map(systemdArgument).join(" ");
	return `[Unit]\nDescription=xcsh remote control supervisor\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nExecStart=${command}\nRestart=on-failure\nRestartSec=1s\nKillMode=mixed\nTimeoutStopSec=85s\nNoNewPrivileges=true\nPrivateTmp=true\n\n[Install]\nWantedBy=default.target\n`;
}

async function atomicText(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${crypto.randomUUID()}`;
	const file = await open(temporary, "wx", 0o600);
	try {
		await file.writeFile(content);
		await file.sync();
	} finally {
		await file.close();
	}
	await rename(temporary, path);
	await chmod(path, 0o600);
}

async function systemctl(args: string[]): Promise<{ code: number; stdout: string }> {
	return new Promise(resolve => {
		const child = spawn("systemctl", ["--user", ...args], { stdio: ["ignore", "pipe", "ignore"] });
		let stdout = "";
		child.stdout.on("data", chunk => (stdout += String(chunk)));
		child.once("error", () => resolve({ code: 127, stdout: "" }));
		child.once("close", code => resolve({ code: code ?? 1, stdout: stdout.trim() }));
	});
}

export class SystemdUserManager {
	readonly unitPath: string;
	constructor(
		configHome: string,
		private readonly executablePath: string,
		private readonly sourceArguments: string[] = [],
		private readonly run: (args: string[]) => Promise<{ code: number; stdout: string }> = systemctl,
	) {
		this.unitPath = join(configHome, "systemd", "user", REMOTE_CONTROL_SERVICE);
	}
	async available(): Promise<boolean> {
		return process.platform === "linux" && (await this.run(["show-environment"])).code === 0;
	}
	async reconcile(): Promise<void> {
		await atomicText(
			this.unitPath,
			renderSystemdUserService({
				executablePath: this.executablePath,
				arguments: [...this.sourceArguments, "remote-control", "supervisor"],
			}),
		);
		if ((await this.run(["daemon-reload"])).code !== 0) throw new Error("Unable to reload the user service manager");
	}
	async enable(): Promise<void> {
		await this.reconcile();
		if ((await this.run(["enable", "--now", REMOTE_CONTROL_SERVICE])).code !== 0)
			throw new Error("Unable to enable the xcsh remote control service");
	}
	async restart(): Promise<void> {
		await this.reconcile();
		if ((await this.run(["enable", REMOTE_CONTROL_SERVICE])).code !== 0)
			throw new Error("Unable to enable the xcsh remote control service");
		if ((await this.run(["restart", REMOTE_CONTROL_SERVICE])).code !== 0)
			throw new Error("Unable to restart the xcsh remote control service");
	}
	async disable(): Promise<void> {
		const result = await this.run(["disable", "--now", REMOTE_CONTROL_SERVICE]);
		if (result.code !== 0 && result.code !== 5) throw new Error("Unable to disable the xcsh remote control service");
	}
	async state(): Promise<"running" | "stopped" | "unavailable"> {
		if (!(await this.available())) return "unavailable";
		return (await this.run(["is-active", "--quiet", REMOTE_CONTROL_SERVICE])).code === 0 ? "running" : "stopped";
	}
}
