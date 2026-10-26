mod client;
mod helper_exit;
#[cfg(any(target_os = "linux", test))]
mod linux_alsa;
mod message_reader;
#[allow(
	clippy::empty_enums,
	reason = "serde generates empty field enums for strict unit-variant decoding"
)]
mod protocol;
mod session;

pub use client::ConnectionError;
pub use client::VoiceHost;
pub use helper_exit::HelperExitStage;
pub use protocol::AudioControls;
pub use protocol::AudioDevice;
pub use protocol::AudioDeviceKind;
pub use protocol::AudioDeviceSelection;
pub use protocol::AudioState;
pub use protocol::MAX_FRAME_BYTES;
pub use protocol::Message;
pub use protocol::RUNTIME_ENVIRONMENT;
pub use protocol::SessionDescription;
pub use protocol::decode_frame;
pub use protocol::encode_frame;
pub use protocol::read_message;
pub use session::RealtimeWebrtcSession;
pub use session::RealtimeWebrtcSessionHandle;
pub use session::StartedRealtimeWebrtcSession;

#[derive(Clone)]
pub struct PackageLayout {
	pub package_dir: std::path::PathBuf,
}
