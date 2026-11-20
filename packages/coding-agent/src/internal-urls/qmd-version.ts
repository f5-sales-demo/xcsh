import metadata from "./qmd-attribution.generated.json";

/** Build-time index generator identity, shipped for attribution without a runtime QMD dependency. */
export const QMD_VERSION: string = metadata.version;
if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(QMD_VERSION)) throw new Error("Installed QMD version is invalid");
