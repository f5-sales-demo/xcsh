export interface AudioDeviceDescription {
	name: string;
	channels: number;
	isDefault: boolean;
}
export interface AudioDeviceCatalog {
	inputs: AudioDeviceDescription[];
	outputs: AudioDeviceDescription[];
}
export interface AudioDevicePreferences {
	microphone?: string;
	speaker?: string;
	channel?: number[];
}

/** Enumeration is a snapshot; opening the helper revalidates the actual devices. */
export function validateAudioPreferences(
	catalog: AudioDeviceCatalog,
	preferences: AudioDevicePreferences,
): Readonly<AudioDevicePreferences> {
	const choose = (devices: AudioDeviceDescription[], name: string | undefined) => {
		if (name === undefined) return undefined;
		const matching = devices.filter(device => device.name === name);
		if (matching.length !== 1) throw new Error("The selected audio device is missing or ambiguous");
		return matching[0]!;
	};
	const input = choose(catalog.inputs, preferences.microphone);
	choose(catalog.outputs, preferences.speaker);
	if (preferences.channel !== undefined) {
		if (
			!input ||
			!preferences.channel.length ||
			preferences.channel.some(channel => !Number.isSafeInteger(channel) || channel < 1 || channel > input.channels)
		)
			throw new Error("Choose valid microphone channels for the selected device");
	}
	return Object.freeze({
		...preferences,
		...(preferences.channel ? { channel: [...new Set(preferences.channel)] } : {}),
	});
}
