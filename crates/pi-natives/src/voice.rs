//! N-API facade over the pinned helper-owning WebRTC actor. Media stays in the child.
use napi_derive::napi;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use xcsh_realtime_webrtc::{
	AudioDeviceKind, AudioDeviceSelection, PackageLayout, RealtimeWebrtcSession,
	RealtimeWebrtcSessionHandle, VoiceHost,
};

#[napi(object)]
pub struct NativeVoicePackageOptions {
	pub package_dir: String,
	pub build_commit: String,
	pub manifest_sha256: String,
	pub microphone: Option<String>,
	pub speaker: Option<String>,
	pub channel: Option<Vec<u32>>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PackageManifest {
	schema_version: u32,
	build_commit: String,
	reference: String,
	files: Vec<PackageFile>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PackageFile {
	path: String,
	sha256: String,
}

fn hex(bytes: &[u8]) -> String {
	const DIGITS: &[u8; 16] = b"0123456789abcdef";
	let mut result = String::with_capacity(bytes.len() * 2);
	for byte in bytes {
		result.push(char::from(DIGITS[usize::from(byte >> 4)]));
		result.push(char::from(DIGITS[usize::from(byte & 15)]));
	}
	result
}
fn verify_package(options: &NativeVoicePackageOptions) -> std::io::Result<PathBuf> {
	let invalid = || std::io::Error::other("Voice package integrity check failed");
	if options.build_commit.len() != 40
		|| !options
			.build_commit
			.bytes()
			.all(|byte| byte.is_ascii_hexdigit())
		|| options.manifest_sha256.len() != 64
	{
		return Err(invalid());
	}
	let root = PathBuf::from(&options.package_dir).canonicalize()?;
	let file = root.join("xcsh-voice-package.json");
	if file.canonicalize()? != file || std::fs::metadata(&file)?.len() > 1_048_576 {
		return Err(invalid());
	}
	let bytes = std::fs::read(file)?;
	if hex(&openssl::sha::sha256(&bytes)) != options.manifest_sha256 {
		return Err(invalid());
	}
	let manifest: PackageManifest = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
	if manifest.schema_version != 1
		|| manifest.build_commit != options.build_commit
		|| manifest.reference != "970111f6cb62cc02fe36a82ea7d71b37a2889c97"
		|| manifest.files.is_empty()
		|| manifest.files.len() > 256
	{
		return Err(invalid());
	}
	let helper = if cfg!(windows) {
		"codex-resources/voice/bin/codex-voice-host.exe"
	} else {
		"codex-resources/voice/bin/codex-voice-host"
	};
	if !manifest.files.iter().any(|entry| entry.path == helper) {
		return Err(invalid());
	}
	let (core, plugin_dir, suffix) = if cfg!(target_os = "macos") {
		("lib/libgstreamer-1.0.0.dylib", "plugins", ".dylib")
	} else if cfg!(windows) {
		("bin/gstreamer-1.0-0.dll", "bin", ".dll")
	} else {
		("lib/libgstreamer-1.0.so.0", "lib/gstreamer-1.0", ".so")
	};
	let mut required = vec![format!("codex-resources/voice/{core}")];
	for name in ["app", "audioconvert", "audioresample", "coreelements", "opus", "rtp", "rtpmanager"]
	{
		let prefix = if cfg!(windows) { "gst" } else { "libgst" };
		required.push(format!("codex-resources/voice/{plugin_dir}/{prefix}{name}{suffix}"));
	}
	if required
		.iter()
		.any(|path| !manifest.files.iter().any(|entry| &entry.path == path))
	{
		return Err(invalid());
	}
	let mut seen = std::collections::HashSet::new();
	for entry in manifest.files {
		let relative = Path::new(&entry.path);
		if relative.is_absolute()
			|| !relative
				.components()
				.all(|part| matches!(part, std::path::Component::Normal(_)))
			|| !entry.path.starts_with("codex-resources/voice/")
			|| !seen.insert(entry.path.clone())
		{
			return Err(invalid());
		}
		let path = root.join(relative);
		if path.canonicalize()? != path
			|| !path.is_file()
			|| hex(&openssl::sha::sha256(&std::fs::read(path)?)) != entry.sha256
		{
			return Err(invalid());
		}
	}
	if !RealtimeWebrtcSession::is_supported(&root) {
		return Err(invalid());
	}
	Ok(root)
}

#[napi(object)]
pub struct NativeVoiceDevice {
	pub name: String,
	pub channels: u32,
	pub is_default: bool,
}
#[napi(object)]
pub struct NativeVoiceDeviceCatalog {
	pub inputs: Vec<NativeVoiceDevice>,
	pub outputs: Vec<NativeVoiceDevice>,
}
fn device_description(device: xcsh_realtime_webrtc::AudioDevice) -> NativeVoiceDevice {
	NativeVoiceDevice {
		name: device.name,
		channels: u32::from(device.channels),
		is_default: device.is_default,
	}
}
/// Same-build enumeration closes its helper and never requests audio streams.
#[napi]
pub async fn native_voice_devices(
	options: NativeVoicePackageOptions,
) -> napi::Result<NativeVoiceDeviceCatalog> {
	let build_commit = options.build_commit.clone();
	let root = tokio::task::spawn_blocking(move || verify_package(&options))
		.await
		.map_err(|_| napi::Error::from_reason("Native device worker stopped"))?
		.map_err(|_| napi::Error::from_reason("Voice package integrity check failed"))?;
	let mut host = VoiceHost::connect(&PackageLayout { package_dir: root }, &build_commit)
		.await
		.map_err(|_| napi::Error::from_reason("Native device helper could not start"))?;
	let result = async {
		let inputs = host
			.list_devices(AudioDeviceKind::Input)
			.await
			.map_err(|_| napi::Error::from_reason("Native input devices unavailable"))?;
		let outputs = host
			.list_devices(AudioDeviceKind::Output)
			.await
			.map_err(|_| napi::Error::from_reason("Native output devices unavailable"))?;
		Ok::<_, napi::Error>(NativeVoiceDeviceCatalog {
			inputs: inputs.into_iter().map(device_description).collect(),
			outputs: outputs.into_iter().map(device_description).collect(),
		})
	}
	.await;
	let closed = host.close().await;
	let catalog =
		result.map_err(|_| napi::Error::from_reason("Native audio devices unavailable"))?;
	closed.map_err(|_| napi::Error::from_reason("Native device helper did not close"))?;
	Ok(catalog)
}

#[napi(object)]
pub struct NativeVoiceAudioState {
	pub applied: bool,
	pub microphone_muted: bool,
	pub speaker_suppressed: bool,
	pub microphone_peak: u32,
	pub speaker_peak: u32,
}

#[napi(js_name = "NativeVoiceAudio")]
pub struct NativeVoiceAudio {
	offer_sdp: String,
	handle: RealtimeWebrtcSessionHandle,
}
#[napi]
impl NativeVoiceAudio {
	#[napi(factory)]
	pub async fn start(options: NativeVoicePackageOptions) -> napi::Result<Self> {
		let session = tokio::task::spawn_blocking(move || {
			let root = verify_package(&options)
				.map_err(|_| napi::Error::from_reason("Voice package integrity check failed"))?;
			let channel = options
				.channel
				.map(|channels| {
					channels
						.into_iter()
						.map(|channel| {
							u16::try_from(channel)
								.ok()
								.and_then(std::num::NonZeroU16::new)
								.ok_or_else(|| napi::Error::from_reason("Invalid microphone channel"))
						})
						.collect::<napi::Result<Vec<_>>>()
				})
				.transpose()?;
			let selection = AudioDeviceSelection {
				microphone: options.microphone,
				speaker: options.speaker,
				channel,
			};
			let (_, cancellation) = futures::future::AbortHandle::new_pair();
			RealtimeWebrtcSession::start(
				PackageLayout { package_dir: root },
				options.build_commit,
				cancellation,
				selection,
			)
			.map_err(|_| napi::Error::from_reason("Native voice helper could not start"))
		})
		.await
		.map_err(|_| napi::Error::from_reason("Native voice worker stopped"))??;
		Ok(Self { offer_sdp: session.offer_sdp, handle: session.handle })
	}
	#[napi(getter)]
	pub fn offer_sdp(&self) -> String {
		self.offer_sdp.clone()
	}
	#[napi]
	pub async fn apply_answer(&self, sdp: String) -> napi::Result<()> {
		let handle = self.handle.clone();
		tokio::task::spawn_blocking(move || handle.apply_answer_sdp(sdp))
			.await
			.map_err(|_| napi::Error::from_reason("Native voice worker stopped"))?
			.map_err(|_| napi::Error::from_reason("Native voice negotiation failed"))
	}
	#[napi]
	pub fn mute(&self, muted: bool) -> napi::Result<()> {
		self
			.handle
			.set_microphone_muted(muted)
			.map_err(|_| napi::Error::from_reason("Native microphone control failed"))
	}
	#[napi]
	pub fn suppress_output(&self, suppressed: bool) {
		self.handle.set_speaker_suppressed(suppressed);
	}
	#[napi]
	pub fn microphone_peak(&self) -> u32 {
		u32::from(self.handle.take_microphone_peak())
	}
	#[napi]
	pub fn speaker_peak(&self) -> u32 {
		u32::from(self.handle.take_speaker_peak())
	}
	#[napi]
	pub fn take_error(&self) -> Option<String> {
		self.handle.take_error().map(|(_, message)| message)
	}
	#[napi]
	pub fn audio_state(&self) -> NativeVoiceAudioState {
		let controls = self.handle.applied_audio_controls();
		NativeVoiceAudioState {
			applied: controls.is_some(),
			microphone_muted: controls.is_none_or(|value| value.microphone_muted),
			speaker_suppressed: controls.is_none_or(|value| value.speaker_suppressed),
			microphone_peak: u32::from(self.handle.take_microphone_peak()),
			speaker_peak: u32::from(self.handle.take_speaker_peak()),
		}
	}
	#[napi]
	pub fn stop(&self) {
		self.handle.close();
	}
}
impl Drop for NativeVoiceAudio {
	fn drop(&mut self) {
		self.handle.close();
	}
}
