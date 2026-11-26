export type ProfileStoreErrorCode =
	| "unsupported_format"
	| "unsupported_platform"
	| "insecure_permissions"
	| "invalid_shape"
	| "ownership_mismatch"
	| "lock_busy"
	| "lock_recovery_unavailable"
	| "persistence_unavailable";
export type ProfileDomain = "person" | "computer";
export class ProfileStoreError extends Error {
	constructor(
		readonly code: ProfileStoreErrorCode,
		readonly domain: ProfileDomain,
		options?: ErrorOptions,
	) {
		super(
			code === "unsupported_platform"
				? `${domain} profile storage unsupported_platform; durable locking is unavailable on ${process.platform}; use a qualified Linux host`
				: code === "lock_busy"
					? `${domain} profile storage lock_busy; wait for the active operation; retain the original lock and owner evidence and verify original-holder closure before recovery`
					: `${domain} profile storage ${code}; run xcsh profile reset ${domain} --yes`,
			options,
		);
		this.name = "ProfileStoreError";
	}
}
