const PACKAGE = "@f5-sales-demo%2Fxcsh";
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;

export async function resolvePublishedNpmVersion(
  selected: string = "",
  fetcher: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = fetch,
): Promise<string> {
  const selection = selected.trim().replace(/^v(?=[0-9])/, "") || "latest";
  if (selection !== "latest" && !VERSION.test(selection)) {
    throw new Error("Select latest or an exact published npm version");
  }
  const response = await fetcher(`https://registry.npmjs.org/${PACKAGE}/${encodeURIComponent(selection)}`);
  if (!response.ok) throw new Error(`npm version ${selection} is not published or unavailable (HTTP ${response.status})`);
  const document: unknown = await response.json();
  const version = document && typeof document === "object" && "version" in document ? document.version : undefined;
  if (typeof version !== "string" || !VERSION.test(version)) throw new Error("npm registry returned an invalid version");
  if (selection !== "latest" && version !== selection) throw new Error("Published version does not match the selected version");
  return version;
}

if (import.meta.main) {
  try {
    console.log(await resolvePublishedNpmVersion(process.env.NPM_VERSION));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Published npm version lookup failed");
    process.exitCode = 1;
  }
}
