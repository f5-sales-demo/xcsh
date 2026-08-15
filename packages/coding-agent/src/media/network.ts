import * as dns from "node:dns/promises";
import type { IncomingHttpHeaders } from "node:http";
import * as https from "node:https";
import * as net from "node:net";

export const DEFAULT_MEDIA_MAX_BYTES = 100 * 1024 * 1024;
export const DEFAULT_MEDIA_CONNECT_TIMEOUT_MS = 10_000;
export const DEFAULT_MEDIA_TOTAL_TIMEOUT_MS = 60_000;
export const DEFAULT_MEDIA_MAX_REDIRECTS = 5;

export interface DownloadedMedia {
	data: Buffer;
	contentType?: string;
	finalUrl: string;
}

export interface MediaRequestOptions {
	maxBytes: number;
	connectTimeoutMs: number;
	totalTimeoutMs: number;
	maxRedirects: number;
}

export type MediaLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;
export type MediaRequest = (
	url: URL,
	address: string,
	options: MediaRequestOptions,
	totalSignal: AbortSignal,
) => Promise<{ status: number; headers: IncomingHttpHeaders; data: Buffer }>;

export interface MediaDownloadOptions {
	maxBytes?: number;
	connectTimeoutMs?: number;
	totalTimeoutMs?: number;
	maxRedirects?: number;
	lookup?: MediaLookup;
	request?: MediaRequest;
	signal?: AbortSignal;
}

function parseIpv4(address: string): number[] | null {
	const parts = address.split(".");
	if (parts.length !== 4) return null;
	const values = parts.map(part => Number(part));
	return values.every(value => Number.isInteger(value) && value >= 0 && value <= 255) ? values : null;
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) throw signal.reason;
	return await new Promise<T>((resolve, reject) => {
		const onAbort = () => {
			cleanup();
			reject(signal.reason);
		};
		const cleanup = () => signal.removeEventListener("abort", onAbort);
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(
			value => {
				cleanup();
				resolve(value);
			},
			error => {
				cleanup();
				reject(error);
			},
		);
	});
}

export function isProhibitedMediaAddress(address: string): boolean {
	let normalized = address.toLowerCase().split("%", 1)[0] ?? address.toLowerCase();
	if (normalized.startsWith("::ffff:")) normalized = normalized.slice(7);
	const v4 = parseIpv4(normalized);
	if (v4) {
		const [a, b] = v4;
		if (a === 0 || a === 127) return true;
		if (a === 169 && b === 254) return true;
		if (a >= 224) return true;
		return false;
	}
	if (net.isIP(normalized) !== 6) return true;
	if (normalized === "::" || normalized === "::1") return true;
	if (/^fe[89ab][0-9a-f]:/u.test(normalized)) return true;
	if (normalized.startsWith("ff")) return true;
	return false;
}

function validateMediaUrl(input: string): URL {
	const url = new URL(input);
	if (url.protocol !== "https:") throw new Error("remote media must use HTTPS");
	if (url.username || url.password) throw new Error("remote media URLs must not contain credentials");
	return url;
}

async function requestPinned(
	url: URL,
	address: string,
	options: MediaRequestOptions,
	totalSignal: AbortSignal,
): Promise<{ status: number; headers: IncomingHttpHeaders; data: Buffer }> {
	return await new Promise((resolve, reject) => {
		const request = https.request({
			protocol: "https:",
			hostname: address,
			port: url.port ? Number(url.port) : 443,
			path: `${url.pathname}${url.search}`,
			method: "GET",
			servername: url.hostname,
			rejectUnauthorized: true,
			headers: {
				Host: url.port ? `${url.hostname}:${url.port}` : url.hostname,
				Accept: "image/*,video/mp4;q=0.9,application/octet-stream;q=0.1",
				"User-Agent": "xcsh-media/1",
			},
			signal: totalSignal,
		});
		const connectTimer = setTimeout(
			() => request.destroy(new Error("media connection timed out")),
			options.connectTimeoutMs,
		);
		request.once("socket", socket => {
			socket.once("secureConnect", () => clearTimeout(connectTimer));
		});
		request.once("error", error => {
			clearTimeout(connectTimer);
			reject(error);
		});
		request.once("response", response => {
			clearTimeout(connectTimer);
			const status = response.statusCode ?? 0;
			const chunks: Buffer[] = [];
			let bytes = 0;
			const declaredBytes = Number(response.headers["content-length"]);
			if (Number.isFinite(declaredBytes) && declaredBytes > options.maxBytes) {
				response.destroy(new Error(`remote media exceeds ${options.maxBytes} byte limit`));
				return;
			}
			response.on("data", chunkValue => {
				const chunk = Buffer.from(chunkValue);
				bytes += chunk.byteLength;
				if (bytes > options.maxBytes) {
					response.destroy(new Error(`remote media exceeds ${options.maxBytes} byte limit`));
					return;
				}
				chunks.push(chunk);
			});
			response.once("error", reject);
			response.once("aborted", () => reject(new Error("remote media response was truncated")));
			response.once("end", () => {
				if (Number.isFinite(declaredBytes) && declaredBytes >= 0 && bytes !== declaredBytes) {
					reject(new Error("remote media response was truncated"));
					return;
				}
				resolve({ status, headers: response.headers, data: Buffer.concat(chunks) });
			});
		});
		request.end();
	});
}

export async function downloadMediaUrl(input: string, options: MediaDownloadOptions = {}): Promise<DownloadedMedia> {
	const resolved = {
		maxBytes: options.maxBytes ?? DEFAULT_MEDIA_MAX_BYTES,
		connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_MEDIA_CONNECT_TIMEOUT_MS,
		totalTimeoutMs: options.totalTimeoutMs ?? DEFAULT_MEDIA_TOTAL_TIMEOUT_MS,
		maxRedirects: options.maxRedirects ?? DEFAULT_MEDIA_MAX_REDIRECTS,
	};
	const lookup: MediaLookup =
		options.lookup ?? (async hostname => await dns.lookup(hostname, { all: true, verbatim: true }));
	const request = options.request ?? requestPinned;
	const controller = new AbortController();
	const onExternalAbort = () => controller.abort(options.signal?.reason ?? new Error("media download aborted"));
	options.signal?.addEventListener("abort", onExternalAbort, { once: true });
	if (options.signal?.aborted) onExternalAbort();
	const totalTimer = setTimeout(
		() => controller.abort(new Error("media download timed out")),
		resolved.totalTimeoutMs,
	);
	try {
		let url = validateMediaUrl(input);
		for (let redirect = 0; redirect <= resolved.maxRedirects; redirect++) {
			const addresses = await abortable(lookup(url.hostname), controller.signal);
			if (addresses.length === 0) throw new Error("remote media host has no addresses");
			if (addresses.some(item => isProhibitedMediaAddress(item.address))) {
				throw new Error("remote media host resolves to a prohibited address");
			}
			const response = await request(url, addresses[0]!.address, resolved, controller.signal);
			if (response.status >= 300 && response.status < 400) {
				const location = response.headers.location;
				if (!location) throw new Error("media redirect is missing a Location header");
				if (redirect === resolved.maxRedirects) throw new Error("media redirect limit exceeded");
				url = validateMediaUrl(new URL(location, url).toString());
				continue;
			}
			if (response.status < 200 || response.status >= 300) {
				throw new Error(`media download failed with HTTP ${response.status}`);
			}
			const header = response.headers["content-type"];
			const contentType = Array.isArray(header) ? header[0] : header?.split(";", 1)[0]?.trim().toLowerCase();
			return { data: response.data, contentType, finalUrl: url.toString() };
		}
		throw new Error("media redirect limit exceeded");
	} finally {
		clearTimeout(totalTimer);
		options.signal?.removeEventListener("abort", onExternalAbort);
	}
}
