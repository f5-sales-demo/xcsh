import { useEffect, useState } from "react";
import { BrowserVoiceClient, type BrowserVoiceSnapshot, type VoiceTransport } from "./browser-client";

/** Shared controls keep capture activation in the user's click handler. */
export function VoiceControls({ transport, ready = true }: { transport: VoiceTransport; ready?: boolean }) {
	const [client, setClient] = useState<BrowserVoiceClient>();
	const [snapshot, setSnapshot] = useState<BrowserVoiceSnapshot>();
	const [microphone, setMicrophone] = useState("");
	const [speaker, setSpeaker] = useState("");
	const [deviceError, setDeviceError] = useState<string>();
	const [devices, setDevices] = useState<{ id: string; label: string; kind: string }[]>([]);
	useEffect(() => {
		if (!ready) return;
		const voice = new BrowserVoiceClient(transport);
		setMicrophone("");
		setSpeaker("");
		setDevices([]);
		setDeviceError(undefined);
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
						disabled={snapshot.pendingCall === true}
						onClick={() => {
							void client.start();
						}}
					>
						Start voice
					</button>
					{snapshot.pendingCall && (
						<button type="button" onClick={() => client.stop()}>
							End previous voice
						</button>
					)}
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
						void client.devices().then(list =>
							setDevices(
								list
									.filter(device => ["audioinput", "audiooutput"].includes(device.kind))
									.map(device => ({
										id: device.deviceId,
										label: device.label || device.kind,
										kind: device.kind,
									})),
							),
						);
					}}
				>
					Devices
				</button>
				{devices.length > 0 && (
					<>
						<label>
							Microphone
							<select
								value={microphone}
								disabled={snapshot.active}
								onChange={event => {
									const value = event.currentTarget.value;
									try {
										client.selectDevices({ microphone: value || undefined, speaker: speaker || undefined });
										setMicrophone(value);
										setDeviceError(undefined);
									} catch {
										setDeviceError("End voice before changing audio devices.");
									}
								}}
							>
								<option value="">System default</option>
								{devices
									.filter(device => device.kind === "audioinput" && device.id)
									.map(device => (
										<option key={device.id} value={device.id}>
											{device.label}
										</option>
									))}
							</select>
						</label>
						{client.outputSelectionSupported ? (
							<label>
								Speaker
								<select
									value={speaker}
									disabled={snapshot.active}
									onChange={event => {
										const value = event.currentTarget.value;
										try {
											client.selectDevices({
												microphone: microphone || undefined,
												speaker: value || undefined,
											});
											setSpeaker(value);
											setDeviceError(undefined);
										} catch {
											setDeviceError("The selected speaker is unavailable.");
										}
									}}
								>
									<option value="">System default</option>
									{devices
										.filter(device => device.kind === "audiooutput" && device.id)
										.map(device => (
											<option key={device.id} value={device.id}>
												{device.label}
											</option>
										))}
								</select>
							</label>
						) : (
							<p>Speaker uses system output.</p>
						)}
					</>
				)}
				{deviceError && <p role="alert">{deviceError}</p>}
			</details>
		</fieldset>
	);
}
