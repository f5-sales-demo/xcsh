/** Persist a connection independently of optional model discovery and selection. */
export async function runProviderConnectionFlow<Credentials, Probe>(options: {
	collectCredentials(): Promise<Credentials | null>;
	probe(credentials: Credentials): Promise<Probe>;
	review?(input: { credentials: Credentials; probe?: Probe }): Promise<boolean>;
	commit(input: { credentials: Credentials; probe?: Probe }): Promise<void>;
	recover(request: { stage: "commit"; error: string; canEdit: boolean }): Promise<"retry" | "edit" | "cancel">;
}): Promise<{ status: "completed"; discoveryError?: string } | { status: "cancelled" }> {
	while (true) {
		const credentials = await options.collectCredentials();
		if (!credentials) return { status: "cancelled" };
		let probe: Probe | undefined;
		let discoveryError: string | undefined;
		try {
			probe = await options.probe(credentials);
		} catch (error) {
			discoveryError = error instanceof Error ? error.message : String(error);
		}
		while (true) {
			if (options.review && !(await options.review({ credentials, probe }))) return { status: "cancelled" };
			try {
				await options.commit({ credentials, probe });
				return { status: "completed", discoveryError };
			} catch (error) {
				const action = await options.recover({
					stage: "commit",
					error: error instanceof Error ? error.message : String(error),
					canEdit: true,
				});
				if (action === "cancel") return { status: "cancelled" };
				if (action === "edit") break;
			}
		}
	}
}
