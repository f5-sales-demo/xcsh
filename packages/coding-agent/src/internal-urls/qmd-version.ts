import metadata from "../../node_modules/@tobilu/qmd/package.json";

/** Actual installed identity, embedded for attribution; never selects a future release. */
export const QMD_VERSION: string = metadata.version;
if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(QMD_VERSION)) throw new Error("Installed QMD version is invalid");
