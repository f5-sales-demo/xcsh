# macOS Homebrew app distribution

Releases from 25.2.4 use a Developer ID signed, notarized app bundle inside a
signed and stapled DMG. Both the app and disk image carry stapled tickets.
Homebrew keeps the app in its versioned Caskroom and links the `xcsh` command
to `xcsh.app/Contents/MacOS/xcsh-darwin-<arch>`. Native addons load only from
that app's `Contents/libexec`; a missing or incompatible installed addon fails
without embedded or cross-channel fallback.

The release retains the deterministic raw ZIP and signed MDM package for their
existing distribution contracts. The Homebrew manifest is captured after app
signing and notarization, outside the sealed app, and is protected by the signed
disk image and immutable release digest.

Linux tests verify staging, architecture, inventory, tamper rejection and native
routing. Apple CI verifies the actual signatures, tickets, mounted image, and
standard-account fresh and upgrade installations. Managed-device acceptance
requires normal Gatekeeper startup and end-to-end testing of the published
artifact; static signature checks alone are insufficient.
