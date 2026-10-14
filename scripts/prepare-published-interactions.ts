import * as fs from "node:fs";
import * as path from "node:path";

const modules = ["contract", "transport", "async-answer", "conversation-plan", "question-form"];

/** Stage canonical headless UI contracts inside the npm artifact, then restore the checkout. */
export function preparePublishedInteractionSources(packageRoot: string, sharedRoot: string): () => void {
	const src = path.join(packageRoot, "src");
	const target = path.join(src, "shared-interactions");
	if (fs.existsSync(target)) throw new Error(`Refusing to overwrite existing publication sources: ${target}`);
	const edits: { file: string; original: string; published: string }[] = [];
	const visit = (directory: string): void => {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			const file = path.join(directory, entry.name);
			if (entry.isDirectory()) visit(file);
			else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
				const original = fs.readFileSync(file, "utf8");
				const published = original.replace(
					/(["'])(?:\.\.\/)+chat-ui\/src\/interactions\/([^"']+)\1/g,
					(_match, quote: string, module: string) => {
						if (!modules.includes(module)) throw new Error(`Unpublished UI module in ${file}: ${module}`);
						const relative = path.relative(path.dirname(file), path.join(target, module)).split(path.sep).join("/");
						return `${quote}${relative.startsWith(".") ? relative : `./${relative}`}${quote}`;
					},
				);
				if (published !== original) edits.push({ file, original, published });
			}
		}
	};
	visit(src);
	// Read everything before mutating, so missing canonical files cannot leave a partial stage.
	const sources = modules.map(module => ({ module, content: fs.readFileSync(path.join(sharedRoot, `${module}.ts`)) }));
	let staged = false;
	const restore = (): void => {
		for (const edit of edits) fs.writeFileSync(edit.file, edit.original);
		if (staged) fs.rmSync(target, { recursive: true, force: true });
	};
	try {
		fs.mkdirSync(target);
		staged = true;
		for (const source of sources) fs.writeFileSync(path.join(target, `${source.module}.ts`), source.content);
		for (const edit of edits) fs.writeFileSync(edit.file, edit.published);
		return restore;
	} catch (error) {
		restore();
		throw error;
	}
}
