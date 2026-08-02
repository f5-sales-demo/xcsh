const IPV4_RE = /(?<![A-Za-z0-9.])((?:[0-9]{1,3}\.){3}[0-9]{1,3})(?:\/([0-9]{1,2}))?(?![A-Za-z0-9.])/g;
const DOTTED_VERSION_PREFIX_RE =
	/(?:(?:chrome|headlesschrome|chromium|firefox|safari|edg|edge|opera)\/\s*$|[A-Za-z0-9_.-]*version[A-Za-z0-9_.-]*\s*[:=]\s*['"`]?\s*$|version[A-Za-z0-9_.-]*\)?\.to(?:be|equal)\(\s*['"`]?\s*$)/i;
const SVG_PATH_ATTRIBUTE_RE = /(?:^|\s)d\s*=\s*(['"])/gi;
const RFC_8555_TERM_RE =
	/_acme-challenge|\bAutomated Certificate Management Environment\s*\(ACME\)|\bRFC\s*8555\s*\(ACME\)|\bACME\s*\(RFC\s*8555\)|\bACME\s+(?:account|authorization|certificate|challenge|client|directory|nonce|order|protocol|server|service)\b/gi;
const RFC_8555_TOKEN_RE = /\0RFC8555_([0-9]+)\0/g;

type Ipv4Address = readonly [number, number, number, number];
type Ipv4Range = readonly [Ipv4Address, number];

const NON_GLOBAL_RANGES: readonly Ipv4Range[] = [
	[[0, 0, 0, 0], 8],
	[[10, 0, 0, 0], 8],
	[[100, 64, 0, 0], 10],
	[[127, 0, 0, 0], 8],
	[[169, 254, 0, 0], 16],
	[[172, 16, 0, 0], 12],
	[[192, 0, 0, 0], 24],
	[[192, 0, 2, 0], 24],
	[[192, 168, 0, 0], 16],
	[[198, 18, 0, 0], 15],
	[[198, 51, 100, 0], 24],
	[[203, 0, 113, 0], 24],
	[[224, 0, 0, 0], 4],
	[[240, 0, 0, 0], 4],
];

const GLOBAL_PROTOCOL_HOSTS = new Set([9, 10]);
const DOCUMENTATION_PREFIXES: readonly (readonly [number, number, number])[] = [
	[192, 0, 2],
	[198, 51, 100],
	[203, 0, 113],
];

interface ProtectedRfc8555Terms {
	text: string;
	terms: string[];
}

/**
 * Serialize generated data with structural newlines but without indentation bloat.
 *
 * Large embedded catalogs used to serialize an entire API specification onto one physical line. Besides making
 * diffs and compiler diagnostics unusable, that joined unrelated prose and the following JSON value into one
 * scanner input line. A description containing a credential-related noun could therefore make the next ordinary
 * string look like an assigned secret. JSON's pretty-printer supplies correct string-aware boundaries, while the
 * fixed continuation prefix keeps adjacent JSON tokens outside scanners' short cross-line separator windows.
 */
export function serializeGeneratedValue(value: unknown): string {
	const serialized = JSON.stringify(value, null, "\t");
	if (serialized === undefined) throw new TypeError("Generated values must be JSON-serializable");
	return serialized.replace(/^\t+/gm, "").replace(/\n/g, "\n      ");
}

function protectRfc8555Terms(text: string): ProtectedRfc8555Terms {
	const terms: string[] = [];
	return {
		text: text.replace(RFC_8555_TERM_RE, term => {
			const token = `\0RFC8555_${terms.length}\0`;
			terms.push(term);
			return token;
		}),
		terms,
	};
}

/** Count uses of the name that are not RFC 8555 terminology. */
export function countAcmePlaceholderOccurrences(text: string): number {
	const protectedText = protectRfc8555Terms(text).text;
	return protectedText.match(/acme/gi)?.length ?? 0;
}

/**
 * Replace fictitious ACME tenants, companies, and hosts with the Example pattern while preserving
 * registered RFC 8555 terminology.
 */
export function sanitizeAcmePlaceholders(text: string): string {
	const protectedTerms = protectRfc8555Terms(text);
	const sanitized = protectedTerms.text
		.replace(/ACME/g, "Example")
		.replace(/Acme/g, "Example")
		.replace(/acme/g, "example");
	return sanitized.replace(RFC_8555_TOKEN_RE, (token, index: string) => protectedTerms.terms[Number(index)] ?? token);
}

function parseIpv4(value: string): Ipv4Address | undefined {
	const octets = value.split(".").map(Number);
	if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
		return undefined;
	}
	return [octets[0], octets[1], octets[2], octets[3]];
}

function toInteger(address: Ipv4Address): number {
	return ((address[0] * 256 + address[1]) * 256 + address[2]) * 256 + address[3];
}

function inRange(address: Ipv4Address, [base, prefix]: Ipv4Range): boolean {
	const divisor = 2 ** (32 - prefix);
	return Math.floor(toInteger(address) / divisor) === Math.floor(toInteger(base) / divisor);
}

function isGloballyRoutableUnicast(address: Ipv4Address): boolean {
	if (address[0] === 192 && address[1] === 0 && address[2] === 0 && GLOBAL_PROTOCOL_HOSTS.has(address[3])) {
		return true;
	}
	return !NON_GLOBAL_RANGES.some(range => inRange(address, range));
}

function isDottedVersion(text: string, offset: number): boolean {
	return DOTTED_VERSION_PREFIX_RE.test(text.slice(Math.max(0, offset - 96), offset));
}

function isInsideSvgPathData(text: string, offset: number): boolean {
	const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
	const prefix = text.slice(lineStart, offset);
	for (const match of prefix.matchAll(SVG_PATH_ATTRIBUTE_RE)) {
		const quote = match[1];
		if (!prefix.slice((match.index ?? 0) + match[0].length).includes(quote)) return true;
	}
	return false;
}

function hashAddress(value: string): number {
	let hash = 0x811c9dc5;
	for (const character of value) {
		hash ^= character.charCodeAt(0);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash;
}

function documentationAddress(value: string, prefixText?: string): string {
	const hash = hashAddress(value);
	const network = DOCUMENTATION_PREFIXES[hash % DOCUMENTATION_PREFIXES.length];
	let host = (Math.floor(hash / DOCUMENTATION_PREFIXES.length) % 254) + 1;
	if (prefixText === undefined) return `${network.join(".")}.${host}`;

	const originalPrefix = Number(prefixText);
	const prefix = Math.max(24, originalPrefix);
	const hostMask = 0xff << (32 - prefix);
	host &= hostMask;
	return `${network.join(".")}.${host}/${prefix}`;
}

/** Replace unsafe generated IPv4 examples with deterministic RFC 5737 values. */
export function sanitizePublicIpv4Examples(text: string): string {
	return text.replace(IPV4_RE, (whole: string, value: string, prefix: string | undefined, offset: number) => {
		const address = parseIpv4(value);
		if (!address || (prefix !== undefined && Number(prefix) > 32)) return whole;
		if (!isGloballyRoutableUnicast(address)) return whole;
		if (isDottedVersion(text, offset) || isInsideSvgPathData(text, offset)) return whole;
		return documentationAddress(value, prefix);
	});
}
