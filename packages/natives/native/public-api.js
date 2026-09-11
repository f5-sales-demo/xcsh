const REMOVED_IMAGE_EXPORTS = new Set(["PhotonImage", "ImageFormat", "SamplingFilter"]);

/**
 * Copy a loaded addon onto the supported public boundary.
 *
 * Older embedded and optional-package addons can still contain the removed Photon image API.
 * A null-prototype copy also prevents a legacy addon prototype from reintroducing those names.
 */
function exposeNativeApi(addon) {
	const exposed = Object.create(null);
	for (const key of Reflect.ownKeys(addon)) {
		if (typeof key === "string" && REMOVED_IMAGE_EXPORTS.has(key)) continue;
		const descriptor = Object.getOwnPropertyDescriptor(addon, key);
		if (descriptor) Object.defineProperty(exposed, key, descriptor);
	}
	return exposed;
}

module.exports = { exposeNativeApi };
