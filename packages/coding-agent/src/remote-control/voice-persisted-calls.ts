/** Durable xcsh ownership receipts, separate from pinned provider schemas. */
export interface PersistedVoiceCall {
	providerCallId: string;
	realtimeSessionId: string | null;
	accountIdSha256: string;
}
export function pendingVoiceCalls(records: Record<string, unknown>[]): {
	calls: PersistedVoiceCall[];
	uncertainCreation: boolean;
} {
	const attempts = new Set<string>();
	const calls = new Map<string, PersistedVoiceCall>();
	let malformedIdentity = false;
	for (const record of records) {
		if (record.kind === "voiceCallCreation") {
			if (typeof record.creationAttemptId !== "string" || !record.creationAttemptId) {
				malformedIdentity = true;
				continue;
			}
			if (record.state === "rejected") attempts.delete(record.creationAttemptId);
			else attempts.add(record.creationAttemptId);
		}
		if (record.kind === "voiceCallIdentity") {
			if (
				typeof record.providerCallId !== "string" ||
				!/^[A-Za-z0-9_-]{1,256}$/.test(record.providerCallId) ||
				typeof record.accountIdSha256 !== "string" ||
				!/^sha256:[a-f0-9]{64}$/.test(record.accountIdSha256) ||
				!(
					record.realtimeSessionId === null ||
					(typeof record.realtimeSessionId === "string" && record.realtimeSessionId.length <= 2048)
				)
			) {
				malformedIdentity = true;
				continue;
			}
			const previous = calls.get(record.providerCallId);
			if (
				previous &&
				(previous.accountIdSha256 !== record.accountIdSha256 ||
					previous.realtimeSessionId !== record.realtimeSessionId)
			) {
				malformedIdentity = true;
				continue;
			}
			if (typeof record.creationAttemptId === "string") attempts.delete(record.creationAttemptId);
			calls.set(record.providerCallId, {
				providerCallId: record.providerCallId,
				realtimeSessionId: record.realtimeSessionId,
				accountIdSha256: record.accountIdSha256,
			});
		}
		if (
			record.kind === "voiceProviderClosure" &&
			record.confirmed === true &&
			typeof record.providerCallId === "string"
		)
			calls.delete(record.providerCallId);
	}
	return { calls: [...calls.values()], uncertainCreation: malformedIdentity || attempts.size > 0 };
}
