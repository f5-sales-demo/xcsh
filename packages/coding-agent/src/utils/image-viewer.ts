/**
 * Opens an image in the system's default image viewer.
 * Returns true if the viewer was launched successfully.
 */
export async function openImageExternal(path: string): Promise<boolean> {
	const command = process.platform === "darwin" ? "open" : "xdg-open";
	try {
		const proc = Bun.spawn([command, path], {
			stdout: "ignore",
			stderr: "ignore",
		});
		await proc.exited;
		return proc.exitCode === 0;
	} catch {
		return false;
	}
}
