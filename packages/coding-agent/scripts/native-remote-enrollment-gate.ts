/** Opt-in live interoperability gate. Does not start a relay or expose terminal sessions. */
import { mkdir, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { AuthStorage } from "@f5-sales-demo/pi-ai";
import { getAgentDbPath, getAgentDir, VERSION } from "@f5-sales-demo/pi-utils";
import { loadRemoteSubscription } from "../src/remote-control/auth";
import { CODEX_PROTOCOL_COMMIT, enrollRemoteHost, RemoteControlError } from "../src/remote-control/enrollment";

async function main(): Promise<void> {
	if (process.argv.slice(2).join(" ") !== "--enroll") {
		process.stdout.write(
			"Usage: bun packages/coding-agent/scripts/native-remote-enrollment-gate.ts --enroll\nCreates an xcsh host enrollment using the selected xcsh ChatGPT subscription. No relay is started.\n",
		);
		process.exitCode = process.argv.length > 2 && process.argv[2] !== "--help" ? 2 : 0;
		return;
	}
	const started = Date.now();
	const storage = await AuthStorage.create(getAgentDbPath());
	try {
		await storage.reload();
		const installationId = crypto.randomUUID();
		const auth = await loadRemoteSubscription(storage, `xcsh-remote-gate-${installationId}`);
		const enrollment = await enrollRemoteHost(
			{
				name: `xcsh · ${hostname()}`,
				version: VERSION,
				installationId,
				os: process.platform,
				arch: process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : process.arch,
			},
			auth,
		);
		// An accepted enrollment is retained privately for the next implementation gate.
		const stateDir = join(getAgentDir(), "remote-control", `gate-${installationId}`);
		await mkdir(stateDir, { recursive: true, mode: 0o700 });
		await writeFile(join(stateDir, "enrollment.json"), JSON.stringify({ installationId, ...enrollment }), {
			mode: 0o600,
			flag: "wx",
		});
		process.stdout.write(
			`${JSON.stringify({ stage: "enrollment", outcome: "accepted", protocolCommit: CODEX_PROTOCOL_COMMIT, elapsedMs: Date.now() - started, credentialsPersisted: true, relayStarted: false })}\n`,
		);
	} catch (error) {
		const evidence = error instanceof RemoteControlError ? error.evidence : { stage: "enrollment" };
		process.stdout.write(
			`${JSON.stringify({ ...evidence, outcome: "blocked", protocolCommit: CODEX_PROTOCOL_COMMIT, elapsedMs: Date.now() - started, message: error instanceof RemoteControlError ? error.message : "Enrollment gate failed; diagnostics withheld" })}\n`,
		);
		process.exitCode = 1;
	} finally {
		storage.close();
	}
}
if (import.meta.main) {
	main().catch(() => {
		process.stderr.write("Enrollment gate initialization failed; diagnostics withheld\n");
		process.exitCode = 1;
	});
}
