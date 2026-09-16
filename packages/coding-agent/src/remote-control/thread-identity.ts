interface RemoteThreadIdentitySource {
	sessionId: string;
	sessionManager: {
		getHeader?: () => { remoteThreadId?: string } | null;
	};
}

export function validRemoteThreadId(value: unknown): string | undefined {
	return typeof value === "string" &&
		value.length > 0 &&
		value.length <= 256 &&
		!value.includes("/") &&
		!value.includes("\\")
		? value
		: undefined;
}

/** Resolve the stable phone-facing identity shared by bridge registration and primary selection. */
export function resolveRemoteThreadId(source: RemoteThreadIdentitySource): string {
	const remoteThreadId = source.sessionManager.getHeader?.()?.remoteThreadId;
	return validRemoteThreadId(remoteThreadId) ?? source.sessionId;
}
