import {
	getLocalXCSHActiveContextPath,
	getLocalXCSHContextPath,
	getLocalXCSHContextsDir,
	getXCSHActiveContextPath,
	getXCSHContextPath,
	getXCSHContextsDir,
} from "./dirs";
import type { ContextPathProvider } from "./xcsh-context-resolver";

/**
 * The xcsh host's path provider for {@link ContextResolver}, wired to the
 * `dirs.ts` family (`~/.config/xcsh/...`). The VS Code extension supplies its
 * own provider from `contextPaths.ts`; both must resolve identical directories.
 */
export const xcshContextPaths: ContextPathProvider = {
	getContextsDir: getXCSHContextsDir,
	getActiveContextPath: getXCSHActiveContextPath,
	getContextPath: getXCSHContextPath,
	getLocalContextsDir: (cwd: string) => getLocalXCSHContextsDir(cwd),
	getLocalActiveContextPath: (cwd: string) => getLocalXCSHActiveContextPath(cwd),
	getLocalContextPath: (name: string, cwd: string) => getLocalXCSHContextPath(name, cwd),
};
