import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthStorage } from "@f5-sales-demo/pi-ai";
import { getAgentDir, setAgentDir } from "@f5-sales-demo/pi-utils";
import { runRemoteControl } from "../../src/remote-control/control";
import * as enrollment from "../../src/remote-control/enrollment";
import { listenLocal } from "../../src/remote-control/ipc";
import * as pairing from "../../src/remote-control/pairing";

const token = `fixture.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" } })).toString("base64url")}.fixture`;

test.each(["success", "network-failure", "auth-failure"] as const)(
	"host credential refresh closes authentication storage before network I/O: %s",
	async outcome => {
		const priorDirectory = getAgentDir();
		const root = await mkdtemp(join(tmpdir(), "xcsh-refresh-storage-"));
		setAgentDir(root);
		const stateDirectory = join(getAgentDir(), "remote-control");
		await mkdir(stateDirectory, { recursive: true });
		const old = {
			server_id: "fixture-server",
			environment_id: "fixture-environment",
			remote_control_token: "fixture-old-token",
			expires_at: "2000-01-01T00:00:00Z",
		};
		await writeFile(
			join(stateDirectory, "host.json"),
			JSON.stringify({ enabled: true, name: "xcsh - fixture", installationId: "fixture-install", enrollment: old }),
		);
		const server = await listenLocal(join(stateDirectory, "host.sock"), peer => {
			peer.handle = async () => ({ relay: "connected" });
		});
		let storageClosed = false;
		let networkStarted = false;
		let storageClosedWhenNetworkStarted: boolean | undefined;
		let paired = false;
		const create = spyOn(AuthStorage, "create").mockResolvedValue({
			reload: async () => {},
			getCredentialSource: () => "stored-oauth",
			getApiKey: async () => {
				if (outcome === "auth-failure") throw new Error("fixture-private-auth-error");
				return token;
			},
			close: () => {
				storageClosed = true;
			},
		} as unknown as AuthStorage);
		const refresh = spyOn(enrollment, "refreshRemoteHost").mockImplementation(async (_identity, auth, previous) => {
			networkStarted = true;
			storageClosedWhenNetworkStarted = storageClosed;
			expect(auth.accountId).toBe("fixture-account");
			expect(previous).toEqual(old);
			await Bun.sleep(1);
			if (outcome === "network-failure") throw new Error("fixture-network-failure");
			return { ...old, remote_control_token: "fixture-new-token", expires_at: "2099-01-01T00:00:00Z" };
		});
		const pair = spyOn(pairing, "startPairing").mockImplementation(async next => {
			paired = true;
			expect(next.remote_control_token).toBe("fixture-new-token");
			return {} as Awaited<ReturnType<typeof pairing.startPairing>>;
		});
		try {
			if (outcome === "success") await runRemoteControl("pair");
			else await expect(runRemoteControl("pair")).rejects.toThrow();
			expect(storageClosed).toBe(true);
			if (networkStarted) expect(storageClosedWhenNetworkStarted).toBe(true);
			expect(networkStarted).toBe(outcome !== "auth-failure");
			expect(paired).toBe(outcome === "success");
		} finally {
			create.mockRestore();
			refresh.mockRestore();
			pair.mockRestore();
			await new Promise<void>(resolve => server.close(() => resolve()));
			setAgentDir(priorDirectory);
			await rm(root, { recursive: true, force: true });
		}
	},
);
