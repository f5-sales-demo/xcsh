import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getBundledModel } from "@f5xc-salesdemos/pi-ai";
import { Snowflake } from "@f5xc-salesdemos/pi-utils";
import { Settings } from "@f5xc-salesdemos/xcsh/config/settings";
import { createAgentSession } from "@f5xc-salesdemos/xcsh/sdk";
import { SessionManager } from "@f5xc-salesdemos/xcsh/session/session-manager";

// Regression for the LSP-startup OOM (#1559): a language server auto-started on a
// large workspace streams output that is buffered unbounded → RangeError: Out of
// memory. `lsp.enabled` must be the master switch for the startup warmup and must
// default to off, so no server is started (and nothing can OOM) unless opted in.
//
// `createAgentSession` only assigns `lspServers` when the warmup gate passes, so
// `lspServers === undefined` proves the warmup never ran. Uses an empty temp dir,
// so no real language server is ever spawned.
describe("LSP startup warmup gating", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const tempDir of tempDirs.splice(0)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	function makeTempDir(): string {
		const tempDir = path.join(os.tmpdir(), `pi-lsp-gate-${Snowflake.next()}`);
		tempDirs.push(tempDir);
		fs.mkdirSync(tempDir, { recursive: true });
		return tempDir;
	}

	async function createSession(settings: Settings) {
		const tempDir = makeTempDir();
		// NOTE: no `enableLsp` option — the lsp.enabled setting must decide.
		return createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
			settings,
			model: getBundledModel("openai", "gpt-4o-mini"),
			disableExtensionDiscovery: true,
			extensions: [],
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
		});
	}

	it("does NOT start the LSP warmup by default (lsp.enabled defaults off)", async () => {
		const { session, lspServers } = await createSession(Settings.isolated());
		try {
			expect(lspServers).toBeUndefined();
		} finally {
			await session.dispose();
		}
	});

	it("starts the LSP warmup only when lsp.enabled is opted in", async () => {
		const { session, lspServers } = await createSession(
			Settings.isolated({ "lsp.enabled": true, "lsp.diagnosticsOnWrite": true }),
		);
		try {
			expect(lspServers).toBeDefined();
		} finally {
			await session.dispose();
		}
	});
});
