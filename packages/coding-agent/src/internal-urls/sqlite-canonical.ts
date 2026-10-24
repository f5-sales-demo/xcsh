export function canonicalizeSqliteHeader(bytes: Buffer): Buffer {
	const header = "SQLite format 3\0";
	if (bytes.byteLength < 100 || bytes.subarray(0, header.length).toString("ascii") !== header) {
		throw new Error("documentation index is not a valid SQLite database");
	}
	const canonical = Buffer.from(bytes);
	// SQLite's file change counter and version-valid-for number describe the
	// connection's write history, not database content. Their values can differ
	// across Bun's platform builds even when every page after the header is
	// identical. Keep the required equality while removing that host history.
	canonical.writeUInt32BE(1, 24);
	canonical.writeUInt32BE(1, 92);
	// The producing SQLite library version is informational and differs between
	// Bun's release-platform builds. It does not affect the file format.
	canonical.writeUInt32BE(3_000_000, 96);
	return canonical;
}
