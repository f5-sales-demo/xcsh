/** A closed downstream pipe is normal CLI termination; other output errors remain fatal. */
function handleOutputError(error: unknown): never {
	if (error && typeof error === "object" && "code" in error && error.code === "EPIPE") process.exit(0);
	throw error;
}

export function installCliOutputHandlers(): void {
	process.stdout.on("error", handleOutputError);
	process.stderr.on("error", handleOutputError);
}

/** Bun may throw synchronously from a fast file-stream write. */
export function writeCliOutput(stream: NodeJS.WriteStream, text: string): void {
	try {
		stream.write(text);
	} catch (error) {
		handleOutputError(error);
	}
}
