import { describe, expect, it } from "bun:test";
import type { SecureContext } from "node:tls";
import {
	certDaysLeft,
	isCertStale,
	isLocalIpServerName,
	LOCALIP_CERT_URL,
	LOCALIP_HOST,
	LOCALIP_KEY_URL,
	provisionPublicCert,
	REFRESH_MS,
	selectServerCert,
	selectSniContext,
} from "../../src/browser/bridge-cert";

// ---------------------------------------------------------------------------
// Fixtures — self-signed certs minted with OpenSSL (`-not_after`), inlined so
// the test needs no network, no keychain, and no committed fixture file. Only
// the CERTIFICATE is needed here (certDaysLeft parses notAfter); the matching
// private keys are intentionally omitted — validation is mocked in the I/O tests.
// ---------------------------------------------------------------------------

// notAfter = 2099-01-01 → always thousands of days out (fresh).
const PEM_VALID = `-----BEGIN CERTIFICATE-----
MIIDVjCCAj6gAwIBAgIUYX5EN2WyI87LjRqmqsKYYWmVK7wwDQYJKoZIhvcNAQEL
BQAwIDEeMBwGA1UEAwwVMTI3LTAtMC0xLmxvY2FsLWlwLnNoMCAXDTI1MDEwMTAw
MDAwMFoYDzIwOTkwMTAxMDAwMDAwWjAgMR4wHAYDVQQDDBUxMjctMC0wLTEubG9j
YWwtaXAuc2gwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCtxZ21KjN7
BjZziSonwDSkBbpbsBWBvhcp+L0C8OcgymQQI6auvDKhnEev/VG56T5MVyddlvuf
QD+tLi9RgQI0FodZ6g5SOKPRfRqDTMzKMxfzk3khFHqI04N21YkLxseTQl3PFjud
wquN6yWCajKjSD0FjMv0fKCqUNk5ekcnKRwzDXEtAdXWfLkyshQ0NpcZZANKyYxi
/mBxYEJBwJsotnbd2tpmpMTP251D4RKg+qSFPyYXOLU8Rt50C1MtW5xK81pvkY05
lCWRi9G08UtbB29NDY1maSubCFGpJYKESlIrun1JZBYRHavA17wSCpk5VIiBx2jD
0k28cQJuF3SLAgMBAAGjgYUwgYIwHQYDVR0OBBYEFJqs6WsJyFOhxbt5P6czucn0
jhg3MB8GA1UdIwQYMBaAFJqs6WsJyFOhxbt5P6czucn0jhg3MA8GA1UdEwEB/wQF
MAMBAf8wLwYDVR0RBCgwJoIVMTI3LTAtMC0xLmxvY2FsLWlwLnNogg0qLmxvY2Fs
LWlwLnNoMA0GCSqGSIb3DQEBCwUAA4IBAQBUVqKdmEwVoq92AkfimWPluTgn5XKu
K3s6CiymNysUERO51qBR+ksdj3Hi1Eq4ffY4AGUYfCkPxWFkwkbR0uVp7HJViZ9i
4rSjcd9fsUhvGTDg5MA8K9AhjyQyIegHjkn211F/NuKo1ms5s/AKMMBBxsdEfo3o
8X42J2UN1zKqQcuSiv/8zUE0uitL3HA4YZ5prArVgmyyW5OTJfTEifn7x3q4nnSI
iiGo65W1zY6qlUYDmEkdExDcFZLeOAZhmuvbcQp9bP6Br2EXTsZ00f4prsHT49iQ
qMRvV9WxPlZkQ0Izl2p5ASE5RaO4Hd0TLx8/Txl3w02m7patYVDNesch
-----END CERTIFICATE-----
`;

// notAfter = 2020-02-01 → long expired (parseable, so days-left is negative,
// distinct from the -1 garbage sentinel).
const PEM_EXPIRED = `-----BEGIN CERTIFICATE-----
MIIDOzCCAiOgAwIBAgIUdsmyyZjvh3hLBP2eunkLIhu7hr0wDQYJKoZIhvcNAQEL
BQAwIDEeMBwGA1UEAwwVMTI3LTAtMC0xLmxvY2FsLWlwLnNoMB4XDTIwMDEwMTAw
MDAwMFoXDTIwMDIwMTAwMDAwMFowIDEeMBwGA1UEAwwVMTI3LTAtMC0xLmxvY2Fs
LWlwLnNoMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArMb7QK0HSiCR
NQL8q0tg0nXE73xTAt5rzQgTDZIpnpFjdqkL55pk4RVIOm8PUBcgzFVo4O3w0qoH
jJvHBGCd7g6Yz2AeZSyM6jdiztdNA+DbN7xbj1hiZUItlUtIQUvOlhqnJzShVopZ
r9CvIcaJLQ/Es+1h2rdQejIhOlUezGQhTn8r2DdJePbFyHNX37R629CaG/bOhTQx
Gd/x9nKjHqB29ZMAgqTdYkMuh76cjKYVvZg1ClMyYrvWqWkkvM1cvGBnocTy1juu
94f7/5OpzsqBEj4ojjLVmKWnsf54T87NMq8HIH7HofYmtkxej4xcamMahXwNDFRy
lzdOeMxqyQIDAQABo20wazAdBgNVHQ4EFgQU02UpEZLV8sKiuWMsM3YaXXcfGVcw
HwYDVR0jBBgwFoAU02UpEZLV8sKiuWMsM3YaXXcfGVcwDwYDVR0TAQH/BAUwAwEB
/zAYBgNVHREEETAPgg0qLmxvY2FsLWlwLnNoMA0GCSqGSIb3DQEBCwUAA4IBAQBk
Z0ctua9NRYkWg2GpiGLqRtVq63qJmVyRLVBGEJLPTsPa5pZU1gf1QwdA5ewzSEDf
1TC52GnayunqdE7UL8I8QMA5G5r6goYELybufRPJHBJj/1ZY60g50b3kCXQDJY3H
kjUDinYZyWOQAS9RZbow0sWEuVhVkrfEdPp/YM574QDtPP08jj6018Kobh7S3+zr
JMHN6Lqx2y0kWZFDr7fWAofPrIjDOToA4lC2cLrx69NOI01HzXFjE8aHYOxbNkXK
qHGSacVsTmO8vNTsIXQ12EXe6CY5kjGJswAxYT4d0sKMhQSuvTXZlp4n5gXNJT8O
I3RSvgDHdBEdBPKIEUNK
-----END CERTIFICATE-----
`;

describe("constants", () => {
	it("expose the local-ip.sh provisioning endpoints and host", () => {
		expect(LOCALIP_CERT_URL).toBe("https://local-ip.sh/server.pem");
		expect(LOCALIP_KEY_URL).toBe("https://local-ip.sh/server.key");
		expect(LOCALIP_HOST).toBe("127-0-0-1.local-ip.sh");
	});
	it("refreshes weekly", () => {
		expect(REFRESH_MS).toBe(7 * 24 * 60 * 60 * 1000);
	});
});

describe("certDaysLeft", () => {
	it("returns a large positive number for a long-lived cert", () => {
		expect(certDaysLeft(PEM_VALID)).toBeGreaterThan(30);
	});
	it("returns a negative number for a parseable but expired cert", () => {
		expect(certDaysLeft(PEM_EXPIRED)).toBeLessThan(0);
	});
	it("returns -1 for garbage input", () => {
		expect(certDaysLeft("not a certificate at all")).toBe(-1);
		expect(certDaysLeft("")).toBe(-1);
	});
	it("accepts a Buffer as well as a string", () => {
		expect(certDaysLeft(Buffer.from(PEM_VALID))).toBeGreaterThan(30);
	});
});

describe("isCertStale", () => {
	it("treats a far-future cert as fresh (>30d)", () => {
		expect(isCertStale(PEM_VALID)).toBe(false);
	});
	it("treats an expired cert as stale (<30d)", () => {
		expect(isCertStale(PEM_EXPIRED)).toBe(true);
	});
	it("treats garbage as stale", () => {
		expect(isCertStale("garbage")).toBe(true);
	});
});

describe("selectServerCert", () => {
	it("prefers the public cert when present", () => {
		expect(selectServerCert({ public: true, selfSigned: true })).toBe("public");
		expect(selectServerCert({ public: true, selfSigned: false })).toBe("public");
	});
	it("falls back to self-signed when the public cert is absent", () => {
		expect(selectServerCert({ public: false, selfSigned: true })).toBe("self-signed");
	});
	it("returns null when neither cert is available", () => {
		expect(selectServerCert({ public: false, selfSigned: false })).toBeNull();
	});
});

describe("isLocalIpServerName", () => {
	it("matches *.local-ip.sh subdomains only", () => {
		expect(isLocalIpServerName("127-0-0-1.local-ip.sh")).toBe(true);
		expect(isLocalIpServerName("anything.local-ip.sh")).toBe(true);
		expect(isLocalIpServerName("local-ip.sh")).toBe(false);
		expect(isLocalIpServerName("localhost")).toBe(false);
		expect(isLocalIpServerName("evil-local-ip.sh")).toBe(false);
		expect(isLocalIpServerName(undefined)).toBe(false);
		expect(isLocalIpServerName(null)).toBe(false);
	});
});

describe("selectSniContext", () => {
	const localIp = { id: "localip" } as unknown as SecureContext;
	const selfSigned = { id: "self" } as unknown as SecureContext;

	it("returns the local-ip context for a *.local-ip.sh servername", () => {
		expect(selectSniContext("127-0-0-1.local-ip.sh", { localIp, selfSigned })).toBe(localIp);
	});
	it("returns the self-signed context for any other servername", () => {
		expect(selectSniContext("localhost", { localIp, selfSigned })).toBe(selfSigned);
		expect(selectSniContext(undefined, { localIp, selfSigned })).toBe(selfSigned);
	});
	it("falls back to self-signed when the local-ip context is missing", () => {
		expect(selectSniContext("x.local-ip.sh", { localIp: null, selfSigned })).toBe(selfSigned);
	});
	it("falls back to the local-ip context when self-signed is missing", () => {
		expect(selectSniContext("localhost", { localIp, selfSigned: null })).toBe(localIp);
	});
});

// ---------------------------------------------------------------------------
// provisionPublicCert — I/O path exercised with injected fetch + fs so no
// network / no keychain is touched. Asserts the freshness gate and the
// "write only on stale AND valid content" guard ported from claude-office.
// ---------------------------------------------------------------------------

function fakeFetch(body: string) {
	let calls = 0;
	const fn = (async (_url: string) => {
		calls++;
		return { ok: true, status: 200, text: async () => body };
	}) as (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
	return { fn, calls: () => calls };
}

function fakeFs(existing: Record<string, string>) {
	const writes: Array<{ path: string; data: string; mode?: number }> = [];
	const store = { ...existing };
	return {
		writes,
		deps: {
			existsSync: (p: string) => p in store,
			readFileSync: (p: string) => Buffer.from(store[p] ?? ""),
			writeFileSync: (p: string, data: string, opts?: { mode?: number }) => {
				store[p] = data;
				writes.push({ path: p, data, mode: opts?.mode });
			},
			mkdirSync: (_p: string, _o: { recursive: boolean }) => {},
		},
	};
}

const CERT_FILE = "/tmp/xcsh-test/bridge/localip.pem";
const KEY_FILE = "/tmp/xcsh-test/bridge/localip.key";
const VALID_KEY = "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n";

describe("provisionPublicCert", () => {
	it("skips the refetch when the existing cert is fresh (>30d)", async () => {
		const fetcher = fakeFetch("");
		const fs = fakeFs({ [CERT_FILE]: PEM_VALID, [KEY_FILE]: VALID_KEY });
		const result = await provisionPublicCert({
			certFile: CERT_FILE,
			keyFile: KEY_FILE,
			fetch: fetcher.fn,
			validatePair: () => {},
			...fs.deps,
		});
		expect(fetcher.calls()).toBe(0);
		expect(result.written).toBe(false);
		expect(result.reason).toBe("fresh");
		expect(fs.writes.length).toBe(0);
	});

	it("refetches and writes when the existing cert is stale AND content is valid", async () => {
		// Distinct cert + key bodies keyed by URL.
		const certFetcher = (async (url: string) => ({
			ok: true,
			status: 200,
			text: async () => (url === LOCALIP_KEY_URL ? VALID_KEY : PEM_VALID),
		})) as (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
		const fs = fakeFs({ [CERT_FILE]: PEM_EXPIRED, [KEY_FILE]: VALID_KEY });
		let validated = false;
		const result = await provisionPublicCert({
			certFile: CERT_FILE,
			keyFile: KEY_FILE,
			fetch: certFetcher,
			validatePair: () => {
				validated = true;
			},
			...fs.deps,
		});
		expect(validated).toBe(true);
		expect(result.written).toBe(true);
		expect(result.reason).toBe("provisioned");
		// Both cert and key written; key written with 0600.
		const certWrite = fs.writes.find(w => w.path === CERT_FILE);
		const keyWrite = fs.writes.find(w => w.path === KEY_FILE);
		expect(certWrite?.data).toContain("BEGIN CERTIFICATE");
		expect(keyWrite?.data).toContain("PRIVATE KEY");
		expect(keyWrite?.mode).toBe(0o600);
	});

	it("does NOT write when the downloaded content is invalid", async () => {
		const badFetcher = (async () => ({
			ok: true,
			status: 200,
			text: async () => "<html>404 not found</html>",
		})) as (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
		const fs = fakeFs({ [CERT_FILE]: PEM_EXPIRED, [KEY_FILE]: VALID_KEY });
		const result = await provisionPublicCert({
			certFile: CERT_FILE,
			keyFile: KEY_FILE,
			fetch: badFetcher,
			validatePair: () => {},
			...fs.deps,
		});
		expect(result.written).toBe(false);
		expect(result.reason).toBe("invalid-content");
		expect(fs.writes.length).toBe(0);
	});

	it("keeps the existing cert (no throw) when the fetch fails", async () => {
		const failFetcher = (async () => {
			throw new Error("network down");
		}) as (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
		const fs = fakeFs({ [CERT_FILE]: PEM_EXPIRED, [KEY_FILE]: VALID_KEY });
		const result = await provisionPublicCert({
			certFile: CERT_FILE,
			keyFile: KEY_FILE,
			fetch: failFetcher,
			validatePair: () => {},
			...fs.deps,
		});
		expect(result.written).toBe(false);
		expect(result.reason).toBe("provision-failed");
		expect(fs.writes.length).toBe(0);
	});

	it("does NOT write when the key/cert pair fails validation", async () => {
		const goodFetcher = (async (url: string) => ({
			ok: true,
			status: 200,
			text: async () => (url === LOCALIP_KEY_URL ? VALID_KEY : PEM_VALID),
		})) as (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
		const fs = fakeFs({ [CERT_FILE]: PEM_EXPIRED, [KEY_FILE]: VALID_KEY });
		const result = await provisionPublicCert({
			certFile: CERT_FILE,
			keyFile: KEY_FILE,
			fetch: goodFetcher,
			validatePair: () => {
				throw new Error("key values mismatch");
			},
			...fs.deps,
		});
		expect(result.written).toBe(false);
		expect(result.reason).toBe("provision-failed");
		expect(fs.writes.length).toBe(0);
	});
});
