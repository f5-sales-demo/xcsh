import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionTarget } from "../../src/remote-control/session";
import { startVoiceCompanion } from "../../src/remote-control/voice-companion";

test.skipIf(!Bun.which("openssl"))(
	"companion HTTPS permits its Home Screen manifest without disclosing its credential",
	async () => {
		const root = await mkdtemp(join(tmpdir(), "xcsh-companion-manifest-"));
		const keys = [
			"XCSH_VOICE_COMPANION_CERT",
			"XCSH_VOICE_COMPANION_KEY",
			"XCSH_VOICE_COMPANION_BIND",
			"XCSH_VOICE_COMPANION_PUBLIC_HOST",
		] as const;
		const previous = keys.map(key => process.env[key]);
		let companion: Awaited<ReturnType<typeof startVoiceCompanion>> | undefined;
		try {
			const certificate = join(root, "certificate.pem"),
				privateKey = join(root, "key.pem");
			const child = Bun.spawn(
				[
					"openssl",
					"req",
					"-x509",
					"-newkey",
					"rsa:2048",
					"-nodes",
					"-keyout",
					privateKey,
					"-out",
					certificate,
					"-days",
					"1",
					"-subj",
					"/CN=localhost",
				],
				{ stdout: "ignore", stderr: "ignore" },
			);
			expect(await child.exited).toBe(0);
			process.env.XCSH_VOICE_COMPANION_CERT = certificate;
			process.env.XCSH_VOICE_COMPANION_KEY = privateKey;
			process.env.XCSH_VOICE_COMPANION_BIND = "127.0.0.1";
			process.env.XCSH_VOICE_COMPANION_PUBLIC_HOST = "127.0.0.1";
			companion = await startVoiceCompanion({ sessionId: "manifest-fixture" } as SessionTarget, () => {});
			const url = new URL(companion.url);
			const page = await fetch(url.origin, { tls: { rejectUnauthorized: false } });
			expect(page.status).toBe(200);
			expect(page.headers.get("Content-Security-Policy")).toContain("manifest-src 'self'");
			expect(await page.text()).toContain('href="/manifest.webmanifest"');
			const response = await fetch(`${url.origin}/manifest.webmanifest`, { tls: { rejectUnauthorized: false } });
			expect(response.status).toBe(200);
			const manifest = await response.text();
			expect(JSON.parse(manifest)).toMatchObject({ start_url: "/", display: "standalone" });
			expect(manifest).not.toContain(url.hash.slice(1));
			expect(response.headers.get("Cache-Control")).toBe("no-store");
		} finally {
			await companion?.close();
			keys.forEach((key, index) => {
				if (previous[index] === undefined) delete process.env[key];
				else process.env[key] = previous[index];
			});
			await rm(root, { recursive: true, force: true });
		}
	},
	15_000,
);
