/**
 * Bridge TLS certificate provisioning for the `wss://` extension-bridge listener.
 *
 * Ported from `claude-office/proxy.mjs` (`certDaysLeft` / `provisionPublicCert` /
 * self-signed fallback / `loadCtx` / SNI selection) into idiomatic TypeScript.
 *
 * The bridge terminates TLS with a **publicly-trusted `*.local-ip.sh`** Let's
 * Encrypt certificate served on the host `127-0-0-1.local-ip.sh` (which resolves
 * to 127.0.0.1). Because the cert chains to a public CA and the hostname matches
 * the `*.local-ip.sh` SAN, WebKit/Chromium open `wss://127-0-0-1.local-ip.sh:<port>`
 * with TLS verification ON and **no local trust / MDM step**. A self-signed
 * localhost cert is a dev-only fallback (it will NOT satisfy WebKit).
 *
 * Design: a clean PURE-vs-I/O split. The freshness gate ({@link certDaysLeft},
 * {@link isCertStale}), default-cert selection ({@link selectServerCert}) and SNI
 * routing ({@link isLocalIpServerName}, {@link selectSniContext}) are pure and unit
 * tested without sockets, fs, or a keychain. The I/O entry points
 * ({@link provisionPublicCert}, {@link provisionSelfSigned}, {@link loadCtx}) accept
 * injectable `fetch`/`fs`/validation dependencies so the download + write path is
 * tested with mocks.
 */
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import {
	chmodSync as nodeChmodSync,
	existsSync as nodeExistsSync,
	mkdirSync as nodeMkdirSync,
	readFileSync as nodeReadFileSync,
	writeFileSync as nodeWriteFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { createSecureContext, type SecureContext } from "node:tls";
import { getXCSHConfigDir } from "@f5-sales-demo/pi-utils";

// ---- public constants (safe to ship) ----------------------------------------

/** local-ip.sh publicly-trusted `*.local-ip.sh` certificate (PEM). */
export const LOCALIP_CERT_URL = "https://local-ip.sh/server.pem";
/** local-ip.sh matching private key (PEM). */
export const LOCALIP_KEY_URL = "https://local-ip.sh/server.key";
/** The only hostname that resolves to 127.0.0.1 AND matches the `*.local-ip.sh` SAN. */
export const LOCALIP_HOST = "127-0-0-1.local-ip.sh";
/** Weekly background refresh interval for the provisioned public cert. */
export const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
/** Refresh the cert once it is within this many days of expiry. */
export const CERT_STALE_THRESHOLD_DAYS = 30;

// ---- storage paths (under getXCSHConfigDir()/bridge/) ------------------------

/** Directory holding the bridge's provisioned certs (`<cfg>/bridge`). */
export function bridgeCertDir(): string {
	return join(getXCSHConfigDir(), "bridge");
}
/** Path to the public `*.local-ip.sh` certificate. */
export function publicCertPath(): string {
	return join(bridgeCertDir(), "localip.pem");
}
/** Path to the public `*.local-ip.sh` private key. */
export function publicKeyPath(): string {
	return join(bridgeCertDir(), "localip.key");
}
/** Path to the self-signed localhost certificate (dev fallback). */
export function selfSignedCertPath(): string {
	return join(bridgeCertDir(), "localhost.pem");
}
/** Path to the self-signed localhost private key (dev fallback). */
export function selfSignedKeyPath(): string {
	return join(bridgeCertDir(), "localhost.key");
}

// ---- pure: freshness ---------------------------------------------------------

/**
 * Days remaining until the certificate's `notAfter`, or `-1` if the input is not
 * a parseable X.509 certificate. A parseable-but-expired cert returns a negative
 * (fractional) number, distinct from the `-1` garbage sentinel.
 */
export function certDaysLeft(pem: string | Buffer): number {
	try {
		const validTo = new Date(new X509Certificate(pem).validTo).getTime();
		return (validTo - Date.now()) / 86_400_000;
	} catch {
		return -1;
	}
}

/** A cert is stale (should be re-provisioned) once it is within the threshold of expiry. */
export function isCertStale(pem: string | Buffer, thresholdDays = CERT_STALE_THRESHOLD_DAYS): boolean {
	return certDaysLeft(pem) < thresholdDays;
}

// ---- pure: content validation ------------------------------------------------

/** Heuristic guard that a downloaded body is a PEM certificate (not an HTML error page). */
export function looksLikeCertPem(body: string): boolean {
	return body.includes("BEGIN CERTIFICATE");
}
/** Heuristic guard that a downloaded body is a PEM private key. */
export function looksLikeKeyPem(body: string): boolean {
	return body.includes("PRIVATE KEY");
}

// ---- pure: default-cert selection --------------------------------------------

/** Which cert the listener should serve by default, given which pairs are available. */
export function selectServerCert(available: { public: boolean; selfSigned: boolean }): "public" | "self-signed" | null {
	if (available.public) return "public";
	if (available.selfSigned) return "self-signed";
	return null;
}

// ---- pure: SNI routing -------------------------------------------------------

/** True only for a `*.local-ip.sh` subdomain (never the bare apex, never a lookalike). */
export function isLocalIpServerName(name: string | null | undefined): boolean {
	return typeof name === "string" && name.endsWith(".local-ip.sh");
}

/**
 * Pick the TLS context for an incoming SNI servername: the public `*.local-ip.sh`
 * context for a matching name, otherwise the self-signed/localhost context. Falls
 * back to whichever context is present when the preferred one is missing.
 */
export function selectSniContext(
	servername: string | null | undefined,
	ctx: { localIp: SecureContext | null; selfSigned: SecureContext | null },
): SecureContext | null {
	if (isLocalIpServerName(servername) && ctx.localIp) return ctx.localIp;
	return ctx.selfSigned ?? ctx.localIp;
}

// ---- I/O: dependency seams ---------------------------------------------------

type FetchResponse = { ok: boolean; status: number; text(): Promise<string> };

/** Injectable I/O dependencies (real implementations used when omitted). */
export interface CertIoDeps {
	certFile?: string;
	keyFile?: string;
	fetch?: (url: string) => Promise<FetchResponse>;
	existsSync?: (path: string) => boolean;
	readFileSync?: (path: string) => Buffer;
	writeFileSync?: (path: string, data: string, opts?: { mode?: number }) => void;
	mkdirSync?: (path: string, opts: { recursive: boolean }) => void;
	/** Validate that the cert and key form a matching pair (throws on mismatch). */
	validatePair?: (cert: string, key: string) => void;
}

function defaultValidatePair(cert: string, key: string): void {
	// Throws on key/cert mismatch — the same guard claude-office relies on.
	createSecureContext({ cert, key });
}

export type ProvisionReason = "fresh" | "provisioned" | "invalid-content" | "provision-failed";

export interface ProvisionResult {
	/** Whether a network fetch was attempted (false when the existing cert was fresh). */
	fetched: boolean;
	/** Whether new cert/key files were written to disk. */
	written: boolean;
	reason: ProvisionReason;
}

/**
 * Ensure a fresh public `*.local-ip.sh` cert+key exist on disk.
 *
 * Mirrors `claude-office`'s `provisionPublicCert`: keep the existing cert when it
 * is present and not stale ({@link isCertStale}); otherwise fetch cert+key and
 * write them ONLY when the download is well-formed PEM AND the pair validates.
 * Never throws — provisioning is best-effort; on any failure the existing (or
 * self-signed) cert is left in place.
 */
export async function provisionPublicCert(deps: CertIoDeps = {}): Promise<ProvisionResult> {
	const certFile = deps.certFile ?? publicCertPath();
	const keyFile = deps.keyFile ?? publicKeyPath();
	const exists = deps.existsSync ?? nodeExistsSync;
	const read = deps.readFileSync ?? nodeReadFileSync;
	const write = deps.writeFileSync ?? ((p, d, o) => nodeWriteFileSync(p, d, o));
	const mkdirp = deps.mkdirSync ?? ((p, o) => nodeMkdirSync(p, o));
	const doFetch = deps.fetch ?? ((url: string) => fetch(url) as Promise<FetchResponse>);
	const validate = deps.validatePair ?? defaultValidatePair;

	// Freshness gate: an existing, non-stale cert is kept as-is (no network hit).
	if (exists(certFile) && exists(keyFile) && !isCertStale(read(certFile))) {
		return { fetched: false, written: false, reason: "fresh" };
	}

	try {
		const [cert, key] = await Promise.all([
			doFetch(LOCALIP_CERT_URL).then(r => {
				if (!r.ok) throw new Error(`cert HTTP ${r.status}`);
				return r.text();
			}),
			doFetch(LOCALIP_KEY_URL).then(r => {
				if (!r.ok) throw new Error(`key HTTP ${r.status}`);
				return r.text();
			}),
		]);
		if (!looksLikeCertPem(cert) || !looksLikeKeyPem(key)) {
			return { fetched: true, written: false, reason: "invalid-content" };
		}
		validate(cert, key); // throws on key/cert mismatch
		mkdirp(dirname(certFile), { recursive: true });
		write(certFile, cert);
		write(keyFile, key, { mode: 0o600 });
		return { fetched: true, written: true, reason: "provisioned" };
	} catch {
		// Keep the existing / self-signed cert; never let provisioning crash boot.
		return { fetched: true, written: false, reason: "provision-failed" };
	}
}

/**
 * Generate a self-signed localhost cert+key (dev-only fallback) if absent.
 * Returns true when a usable pair exists afterwards. Requires `openssl` on PATH.
 */
export function provisionSelfSigned(deps: CertIoDeps = {}): boolean {
	const certFile = deps.certFile ?? selfSignedCertPath();
	const keyFile = deps.keyFile ?? selfSignedKeyPath();
	const exists = deps.existsSync ?? nodeExistsSync;
	const mkdirp = deps.mkdirSync ?? ((p, o) => nodeMkdirSync(p, o));

	if (exists(certFile) && exists(keyFile)) return true;
	try {
		mkdirp(dirname(certFile), { recursive: true });
		execFileSync(
			"openssl",
			[
				"req",
				"-x509",
				"-newkey",
				"rsa:2048",
				"-sha256",
				"-days",
				"800",
				"-nodes",
				"-keyout",
				keyFile,
				"-out",
				certFile,
				"-subj",
				"/CN=localhost",
				"-addext",
				"subjectAltName=DNS:localhost,IP:127.0.0.1",
				"-addext",
				"extendedKeyUsage=serverAuth",
				"-addext",
				"basicConstraints=critical,CA:FALSE",
			],
			{ stdio: "ignore" },
		);
		nodeChmodSync(keyFile, 0o600);
		return true;
	} catch {
		return false;
	}
}

/**
 * Load a {@link SecureContext} from a cert/key file pair, or `null` if the files
 * are missing or fail to load (e.g. a mismatched pair).
 */
export function loadCtx(
	certFile: string,
	keyFile: string,
	deps: Pick<CertIoDeps, "existsSync" | "readFileSync"> = {},
): SecureContext | null {
	const exists = deps.existsSync ?? nodeExistsSync;
	const read = deps.readFileSync ?? nodeReadFileSync;
	if (!exists(certFile) || !exists(keyFile)) return null;
	try {
		return createSecureContext({ cert: read(certFile), key: read(keyFile) });
	} catch {
		return null;
	}
}
