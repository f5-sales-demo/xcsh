// Paginate indivisible discovery choices without losing any destination.
export function terraformChoiceResponse(
	prefix: string,
	entries: string[],
	request: URL,
	after: string | null,
	budget = 4096,
): string {
	const offset = after === null ? 0 : Number(after);
	if (
		after !== null &&
		(!/^(?:0|[1-9][0-9]*)$/.test(after) || !Number.isSafeInteger(offset) || offset >= entries.length)
	)
		throw new Error("Invalid Terraform choice continuation");
	const pieces = [prefix];
	let index = offset;
	let continuation = "";
	for (; index < entries.length; index++) {
		const next = new URL(request.href);
		next.searchParams.set("choice_after", String(index + 1));
		const suffix = index + 1 < entries.length ? `\n\nContinue: ${next.href}` : "";
		const candidate = `${pieces.join("\n\n")}\n\n${entries[index]}${suffix}`;
		if (Buffer.byteLength(candidate) > budget) break;
		pieces.push(entries[index]!);
		continuation = suffix;
	}
	if (index === offset && index < entries.length) throw new Error("Terraform choice exceeds response budget");
	return pieces.join("\n\n") + continuation;
}
