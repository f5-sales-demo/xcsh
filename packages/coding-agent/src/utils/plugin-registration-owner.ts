/** Compare one installed plugin entry across versioned cache snapshots. Exact paths remain the retirement authority. */
function installedEntry(owner: string): string | undefined {
	const normalized = owner.replaceAll("\\", "/");
	const marker = "/plugins/cache/plugins/";
	const offset = normalized.lastIndexOf(marker);
	if (offset < 0) return undefined;
	const tail = normalized.slice(offset + marker.length);
	const separator = tail.indexOf("/");
	if (separator < 0) return undefined;
	const folder = tail.slice(0, separator);
	const match = /^(.+___[^/]+)___\d+\.\d+\.\d+(?:\+snapshot\.[a-f0-9]{16,64})?$/.exec(folder);
	if (!match) return undefined;
	return normalized.slice(0, offset + marker.length) + match[1] + tail.slice(separator);
}

export function samePluginRegistrationOwner(left: string | undefined, right: string | undefined): boolean {
	if (!left || !right) return false;
	if (left === right) return true;
	const existing = installedEntry(left);
	return existing !== undefined && existing === installedEntry(right);
}
