import { useEffect, useState } from "react";
import { BrowserVoiceClient, type BrowserVoiceSnapshot, type VoiceTransport } from "./browser-client";

/** Shared controls keep capture activation in the user's click handler. */
export function VoiceControls({ transport, ready = true }: { transport: VoiceTransport; ready?: boolean }) {
	const [client, setClient] = useState<BrowserVoiceClient>();
	const [snapshot, setSnapshot] = useState<BrowserVoiceSnapshot>();
	const [devices, setDevices] = useState<{ id: string; label: string }[]>([]);
	useEffect(() => {
		if (!ready) return;
		const voice = new BrowserVoiceClient(transport);
		setClient(voice);
		const unsubscribe = voice.subscribe(setSnapshot);
		return () => {
			unsubscribe();
			voice.dispose();
			setClient(undefined);
		};
	}, [transport, ready]);
	if (!client || !snapshot?.available) return null;
	return (
		<fieldset className="voice-controls">
			<legend>Voice</legend>
			{snapshot.active ? (
				<>
					<span role="status">{snapshot.state}</span>
					<button type="button" onClick={() => client.mute(snapshot.state !== "Muted")}>
						{snapshot.state === "Muted" ? "Unmute" : "Mute"}
					</button>
					<button type="button" onClick={() => client.pause()}>
						Pause
					</button>
					<button type="button" onClick={() => client.resume()}>
						Resume
					</button>
					<button type="button" onClick={() => client.interrupt()}>
						Interrupt
					</button>
					<button type="button" disabled={snapshot.state === "Closing"} onClick={() => client.stop()}>
						End voice
					</button>
				</>
			) : (
				<>
					<button
						type="button"
						onClick={() => {
							void client.start();
						}}
					>
						Start voice
					</button>
					{snapshot.ownerRevision !== undefined && (
						<button
							type="button"
							onClick={() => {
								void client.start(true);
							}}
						>
							Take over audio
						</button>
					)}
				</>
			)}
			<button type="button" onClick={() => client.companion()}>
				Use companion
			</button>
			{snapshot.companionUrl && (
				<a href={snapshot.companionUrl} target="_blank" rel="noreferrer">
					Open voice companion
				</a>
			)}
			<details>
				<summary>Voice details</summary>
				{snapshot.message && <p>{snapshot.message}</p>}
				{snapshot.caption && <p>{snapshot.caption}</p>}
				{snapshot.closureConfirmed !== undefined && (
					<p>{snapshot.closureConfirmed ? "Provider closure confirmed" : "Provider closure unconfirmed"}</p>
				)}
				<button
					type="button"
					onClick={() => {
						void client
							.devices()
							.then(list =>
								setDevices(
									list
										.filter(device => ["audioinput", "audiooutput"].includes(device.kind))
										.map(device => ({ id: device.deviceId, label: device.label || device.kind })),
								),
							);
					}}
				>
					Devices
				</button>
				{devices.map(device => (
					<p key={device.id}>{device.label}</p>
				))}
			</details>
		</fieldset>
	);
}
