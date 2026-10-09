unsafe extern "C" {
	fn xcsh_pkcs12_key_count(
		bytes: *const u8,
		length: usize,
		password: *const std::ffi::c_char,
		pass_len: i32,
	) -> i32;
}
// F5 Blindfold binary envelope and certificate parsing. No external executables.
use napi::bindgen_prelude::*;
use napi_derive::napi;
use openssl::{
	asn1::Asn1Time,
	base64::{decode_block, encode_block},
	bn::{BigNum, BigNumContext},
	hash::MessageDigest,
	pkcs12::Pkcs12,
	pkey::{Id, PKey, Private},
	rand::rand_bytes,
	symm::{Cipher, encrypt_aead},
	x509::X509,
};
use serde::Deserialize;
use std::{cmp::Ordering, fmt::Write, fs};
use zeroize::Zeroizing;

#[napi(object)]
pub struct BlindfoldInput {
	pub public_key_json: String,
	pub policy_json: String,
	pub input: Option<String>,
	pub cert: Option<String>,
	pub key: Option<String>,
	pub bundle: Option<String>,
	pub passphrase_env: Option<String>,
	pub max_encoded_size: Option<u32>,
	pub inspect_only: Option<bool>,
}
#[napi(object)]
pub struct BlindfoldPrepared {
	pub location: String,
	pub certificate_url: Option<String>,
	pub fingerprint: Option<String>,
	pub expires_at: Option<String>,
	pub algorithm: Option<String>,
	pub tenant: String,
}
#[derive(Deserialize)]
struct Document<T> {
	data: T,
}
#[derive(Deserialize)]
struct PublicKey {
	tenant: String,
	key_version: u32,
	modulus_base64: String,
	public_exponent_base64: String,
}
#[derive(Deserialize)]
struct Policy {
	tenant: String,
	policy_id: String,
}
fn fail(message: &'static str) -> Error {
	Error::from_reason(message)
}
fn read_file(path: &str) -> Result<Zeroizing<Vec<u8>>> {
	let metadata = fs::metadata(path).map_err(|_| fail("Cannot read Blindfold input"))?;
	if !metadata.is_file() || metadata.len() > 2 * 1024 * 1024 {
		return Err(fail("Blindfold input must be a file smaller than 2 MiB"));
	}
	use std::io::Read;
	let file = fs::File::open(path).map_err(|_| fail("Cannot read Blindfold input"))?;
	let mut bytes = Zeroizing::new(Vec::with_capacity(2 * 1024 * 1024 + 1));
	file
		.take(2 * 1024 * 1024 + 1)
		.read_to_end(&mut bytes)
		.map_err(|_| fail("Cannot read Blindfold input"))?;
	if bytes.len() > 2 * 1024 * 1024 {
		return Err(fail("Blindfold input exceeds 2 MiB"));
	}
	Ok(bytes)
}
fn password(env: Env, name: Option<&str>) -> Result<Zeroizing<String>> {
	match name {
		None => Ok(Zeroizing::new(String::new())),
		Some(name)
			if !name.is_empty()
				&& name.bytes().enumerate().all(|(i, b)| {
					b == b'_' || b.is_ascii_alphabetic() || (i > 0 && b.is_ascii_digit())
				}) =>
		{
			let global = env.get_global()?;
			let process: Object = global.get_named_property("process")?;
			let variables: Object = process
				.get("env")?
				.ok_or_else(|| fail("Passphrase environment variable is unavailable"))?;
			variables
				.get::<String>(name)?
				.map(Zeroizing::new)
				.ok_or_else(|| fail("Passphrase environment variable is unavailable"))
		},
		_ => Err(fail("Invalid passphrase environment variable name")),
	}
}
fn certificates(env: Env, input: &BlindfoldInput) -> Result<(PKey<Private>, Vec<X509>)> {
	let pass = password(env, input.passphrase_env.as_deref())?;
	if let Some(bundle) = &input.bundle {
		if input.cert.is_some() || input.key.is_some() || input.input.is_some() {
			return Err(fail("Use either a bundle or certificate and key files"));
		}
		let bytes = read_file(bundle)?;
		// OpenSSL's high-level parser selects one pair. Enumerate all bags first so selection cannot hide ambiguity.
		if pass.as_bytes().contains(&0) {
			return Err(fail("Invalid PKCS#12 passphrase"));
		}
		let mut password_c = Zeroizing::new(pass.as_bytes().to_vec());
		password_c.push(0);
		// SAFETY: slices and CString remain alive during the call; C reads their bounded lengths and owns all parsed allocations.
		let count = unsafe {
			xcsh_pkcs12_key_count(
				bytes.as_ptr(),
				bytes.len(),
				password_c.as_ptr().cast(),
				i32::try_from(pass.len()).map_err(|_| fail("Passphrase too long"))?,
			)
		};
		if count < 0 {
			return Err(fail("Invalid PKCS#12 bundle or passphrase"));
		}
		if count != 1 {
			return Err(fail("PKCS#12 bundle must contain exactly one private key"));
		}
		let parsed = Pkcs12::from_der(&bytes)
			.and_then(|v| v.parse2(&pass))
			.map_err(|_| fail("Invalid PKCS#12 bundle or passphrase"))?;
		let key = parsed
			.pkey
			.ok_or_else(|| fail("PKCS#12 bundle has no private key"))?;
		let mut certs = vec![
			parsed
				.cert
				.ok_or_else(|| fail("PKCS#12 bundle has no certificate"))?,
		];
		if let Some(chain) = parsed.ca {
			certs.extend(chain);
		}
		return Ok((key, certs));
	}
	if input.input.is_some() {
		return Err(fail("Certificate inputs cannot be mixed with a secret file"));
	}
	let cert = input
		.cert
		.as_ref()
		.ok_or_else(|| fail("Certificate and key files are required"))?;
	let key = input
		.key
		.as_ref()
		.ok_or_else(|| fail("Certificate and key files are required"))?;
	let bytes = read_file(key)?;
	if bytes.windows(5).filter(|v| *v == b"BEGIN").count() != 1 {
		return Err(fail("PEM key file must contain exactly one private key"));
	}
	let key = if input.passphrase_env.is_some() {
		PKey::private_key_from_pem_passphrase(&bytes, pass.as_bytes())
	} else {
		PKey::private_key_from_pem_callback(&bytes, |_| Err(openssl::error::ErrorStack::get()))
	}
	.map_err(|_| fail("Invalid PEM private key or passphrase"))?;
	let certs =
		X509::stack_from_pem(&read_file(cert)?).map_err(|_| fail("Invalid PEM certificate chain"))?;
	Ok((key, certs))
}
fn validate_pair(key: &PKey<Private>, certs: &[X509]) -> Result<&'static str> {
	let algo = match key.id() {
		Id::RSA if (2048..=8192).contains(&key.bits()) => {
			key.rsa()
				.and_then(|rsa| rsa.check_key())
				.map_err(|_| fail("Invalid RSA private key"))?;
			"RSA"
		},
		Id::EC => {
			let ec = key.ec_key().map_err(|_| fail("Invalid EC key"))?;
			ec.check_key().map_err(|_| fail("Invalid EC key"))?;
			match ec.group().curve_name() {
				Some(openssl::nid::Nid::X9_62_PRIME256V1 | openssl::nid::Nid::SECP384R1) => "EC",
				_ => return Err(fail("Supported EC curves are P-256 and P-384")),
			}
		},
		_ => return Err(fail("Supported keys are RSA 2048-8192 and EC P-256/P-384")),
	};
	let leaf = certs
		.first()
		.ok_or_else(|| fail("Certificate chain is empty"))?;
	if !leaf
		.public_key()
		.map_err(|_| fail("Invalid certificate public key"))?
		.public_eq(key)
	{
		return Err(fail("Certificate does not match private key"));
	}
	let now = Asn1Time::days_from_now(0).map_err(|_| fail("Cannot validate certificate time"))?;
	for cert in certs {
		if cert
			.not_before()
			.compare(&now)
			.map_err(|_| fail("Invalid certificate time"))?
			== Ordering::Greater
			|| cert
				.not_after()
				.compare(&now)
				.map_err(|_| fail("Invalid certificate time"))?
				!= Ordering::Greater
		{
			return Err(fail("Certificate chain is expired or not yet valid"));
		}
	}
	for pair in certs.windows(2) {
		let issuer_key = pair[1].public_key().map_err(|_| fail("Invalid chain"))?;
		if pair[0]
			.issuer_name()
			.to_der()
			.map_err(|_| fail("Invalid chain"))?
			!= pair[1]
				.subject_name()
				.to_der()
				.map_err(|_| fail("Invalid chain"))?
			|| !pair[0]
				.verify(&issuer_key)
				.map_err(|_| fail("Invalid chain"))?
		{
			return Err(fail(
				"Certificate chain must be ordered leaf to issuer with valid signatures",
			));
		}
	}
	Ok(algo)
}
fn lp(out: &mut Vec<u8>, value: &[u8]) -> Result<()> {
	let len =
		u32::try_from(value.len()).map_err(|_| fail("Blindfold field exceeds binary size limit"))?;
	out.extend(len.to_be_bytes());
	out.extend(value);
	Ok(())
}
fn encrypt(secret: &[u8], public: &PublicKey, policy: &Policy, max_size: u32) -> Result<String> {
	if public.tenant != policy.tenant || public.tenant.is_empty() {
		return Err(fail("Public key and policy tenant mismatch"));
	}
	if public.key_version == 0 {
		return Err(fail("Invalid public key version"));
	}
	let modulus =
		decode_block(&public.modulus_base64).map_err(|_| fail("Malformed public modulus"))?;
	let exponent = decode_block(&public.public_exponent_base64)
		.map_err(|_| fail("Malformed public exponent"))?;
	let n = BigNum::from_slice(&modulus).map_err(|_| fail("Malformed public modulus"))?;
	let e = BigNum::from_slice(&exponent).map_err(|_| fail("Malformed public exponent"))?;
	if !(2048..=8192).contains(&n.num_bits())
		|| !n.is_odd()
		|| !e.is_odd()
		|| e.num_bits() < 2
		|| e.ucmp(&n) != Ordering::Less
	{
		return Err(fail("Invalid tenant RSA public material"));
	}
	let pid = policy
		.policy_id
		.parse::<u64>()
		.map_err(|_| fail("Malformed policy ID"))?;
	let factor = BigNum::from_dec_str(&(2 * u128::from(pid) + (1u128 << 31) + 1).to_string())
		.map_err(|_| fail("Invalid policy ID"))?;
	let mut ctx = BigNumContext::new().map_err(|_| fail("Encryption failed"))?;
	let mut effective = BigNum::new().map_err(|_| fail("Encryption failed"))?;
	effective
		.checked_mul(&e, &factor, &mut ctx)
		.map_err(|_| fail("Encryption failed"))?;
	let width = usize::try_from(n.num_bytes()).map_err(|_| fail("Invalid RSA modulus size"))?;
	let mut block = Zeroizing::new(vec![0u8; width - 2]);
	rand_bytes(&mut block).map_err(|_| fail("Random generation failed"))?;
	block[..4].copy_from_slice(&[0xde, 0xad, 0xbe, 0xef]);
	let mut tag = [0u8; 16];
	let ciphertext = encrypt_aead(
		Cipher::aes_256_gcm(),
		&block[16..48],
		Some(&block[4..16]),
		&[],
		secret,
		&mut tag,
	)
	.map_err(|_| fail("Encryption failed"))?;
	let mut m = BigNum::from_slice(&block).map_err(|_| fail("Encryption failed"))?;
	let mut wrapped = BigNum::new().map_err(|_| fail("Encryption failed"))?;
	wrapped
		.mod_exp(&m, &effective, &n, &mut ctx)
		.map_err(|_| fail("Encryption failed"))?;
	m.clear();
	let mut out = Vec::new();
	lp(&mut out, public.tenant.as_bytes())?;
	out.extend(public.key_version.to_be_bytes());
	out.extend(pid.to_be_bytes());
	out.push(2);
	lp(&mut out, &e.to_vec())?;
	lp(&mut out, &n.to_vec())?;
	lp(
		&mut out,
		&wrapped
			.to_vec_padded(n.num_bytes())
			.map_err(|_| fail("Encryption failed"))?,
	)?;
	out.extend(ciphertext);
	out.extend(tag);
	let location = format!("string:///{}", encode_block(&out));
	if location.len() > max_size as usize {
		return Err(fail("Encoded Blindfold output exceeds size limit"));
	}
	Ok(location)
}
/// Read secret files directly into native memory and return only encrypted/public material.
#[napi]
pub fn blindfold_prepare(env: Env, input: BlindfoldInput) -> Result<BlindfoldPrepared> {
	let public: Document<PublicKey> = serde_json::from_str(&input.public_key_json)
		.map_err(|_| fail("Malformed tenant public key document"))?;
	let policy: Document<Policy> = serde_json::from_str(&input.policy_json)
		.map_err(|_| fail("Malformed secret policy document"))?;
	let (secret, certificate_url, fingerprint, expires_at, algorithm) =
		if let Some(path) = &input.input {
			if input.cert.is_some()
				|| input.key.is_some()
				|| input.bundle.is_some()
				|| input.passphrase_env.is_some()
			{
				return Err(fail("Secret encryption accepts only an input file"));
			}
			(read_file(path)?, None, None, None, None)
		} else {
			let (key, mut certs) = certificates(env, &input)?;
			let mut matching = Vec::new();
			for (index, cert) in certs.iter().enumerate() {
				if cert
					.public_key()
					.map_err(|_| fail("Invalid certificate public key"))?
					.public_eq(&key)
				{
					matching.push(index);
				}
			}
			if matching.len() != 1 {
				return Err(fail("Certificate must match exactly one leaf"));
			}
			certs.swap(0, matching[0]);
			for index in 0..certs.len().saturating_sub(1) {
				let mut issuer = None;
				for candidate in index + 1..certs.len() {
					let issuer_key = certs[candidate]
						.public_key()
						.map_err(|_| fail("Invalid chain"))?;
					if certs[index]
						.issuer_name()
						.to_der()
						.map_err(|_| fail("Invalid chain"))?
						== certs[candidate]
							.subject_name()
							.to_der()
							.map_err(|_| fail("Invalid chain"))?
						&& certs[index]
							.verify(&issuer_key)
							.map_err(|_| fail("Invalid chain"))?
					{
						if issuer.is_some() {
							return Err(fail("Ambiguous certificate issuer"));
						}
						issuer = Some(candidate);
					}
				}
				certs.swap(index + 1, issuer.ok_or_else(|| fail("Invalid certificate chain"))?);
			}
			let mut seen = std::collections::HashSet::new();
			for cert in &certs {
				if !seen.insert(cert.to_der().map_err(|_| fail("Invalid certificate"))?) {
					return Err(fail("Duplicate certificate"));
				}
			}
			let last = certs.last().ok_or_else(|| fail("Empty chain"))?;
			if last
				.issuer_name()
				.to_der()
				.map_err(|_| fail("Invalid chain"))?
				== last
					.subject_name()
					.to_der()
					.map_err(|_| fail("Invalid chain"))?
			{
				let issuer_key = last.public_key().map_err(|_| fail("Invalid chain"))?;
				if !last
					.verify(&issuer_key)
					.map_err(|_| fail("Invalid chain"))?
				{
					return Err(fail("Invalid root signature"));
				}
			}
			let algo = validate_pair(&key, &certs)?;
			let mut chain = Vec::new();
			for cert in &certs {
				chain.extend(
					cert
						.to_pem()
						.map_err(|_| fail("Cannot encode certificate"))?,
				);
			}
			if 10 + 4 * chain.len().div_ceil(3) > 131_072 {
				return Err(fail("Encoded certificate chain exceeds size limit"));
			}
			let fingerprint = certs[0]
				.digest(MessageDigest::sha256())
				.map_err(|_| fail("Cannot fingerprint certificate"))?
				.iter()
				.fold(String::with_capacity(64), |mut out, b| {
					let _ = write!(out, "{b:02x}");
					out
				});
			(
				Zeroizing::new(
					key.private_key_to_pem_pkcs8()
						.map_err(|_| fail("Cannot encode private key"))?,
				),
				Some(format!("string:///{}", encode_block(&chain))),
				Some(fingerprint),
				Some(certs[0].not_after().to_string()),
				Some(algo.to_owned()),
			)
		};
	let location = if input.inspect_only.unwrap_or(false) {
		String::new()
	} else {
		encrypt(&secret, &public.data, &policy.data, input.max_encoded_size.unwrap_or(131_072))?
	};
	Ok(BlindfoldPrepared {
		location,
		certificate_url,
		fingerprint,
		expires_at,
		algorithm,
		tenant: public.data.tenant,
	})
}

/// Secret bytes never cross N-API. Polling keeps pipe reads cancellable without changing fd flags.
#[napi(ts_return_type = "Promise<BlindfoldPrepared>")]
pub fn blindfold_encrypt_input(
	input: BlindfoldInput,
	signal: Option<Unknown>,
) -> AsyncTask<crate::task::Blocking<BlindfoldPrepared>> {
	use napi::JsValue;
	let already_aborted = signal
		.as_ref()
		.and_then(|v| v.coerce_to_object().ok())
		.and_then(|v| v.get_named_property::<bool>("aborted").ok())
		.unwrap_or(false);
	let cancel = crate::task::CancelToken::new(None, signal);
	crate::task::blocking("blindfold_encrypt_input", cancel, move |cancel| {
		if already_aborted {
			return Err(fail("Blindfold operation cancelled"));
		}
		cancel.heartbeat()?;
		if input.cert.is_some()
			|| input.key.is_some()
			|| input.bundle.is_some()
			|| input.passphrase_env.is_some()
		{
			return Err(fail("Secret encryption accepts only an input file or stdin"));
		}
		let public: Document<PublicKey> = serde_json::from_str(&input.public_key_json)
			.map_err(|_| fail("Malformed tenant public key document"))?;
		let policy: Document<Policy> = serde_json::from_str(&input.policy_json)
			.map_err(|_| fail("Malformed secret policy document"))?;
		let source = input
			.input
			.as_deref()
			.ok_or_else(|| fail("Secret input is required"))?;
		let secret = if source == "-" {
			read_stdin(&cancel)?
		} else {
			read_file(source)?
		};
		cancel.heartbeat()?;
		let location =
			encrypt(&secret, &public.data, &policy.data, input.max_encoded_size.unwrap_or(131_072))?;
		cancel.heartbeat()?;
		Ok(BlindfoldPrepared {
			location,
			certificate_url: None,
			fingerprint: None,
			expires_at: None,
			algorithm: None,
			tenant: public.data.tenant,
		})
	})
}
#[cfg(unix)]
fn read_stdin(cancel: &crate::task::CancelToken) -> Result<Zeroizing<Vec<u8>>> {
	// SAFETY: isatty only inspects the process-owned standard input descriptor.
	if unsafe { libc::isatty(libc::STDIN_FILENO) } == 1 {
		return Err(fail("Blindfold stdin must be redirected"));
	}
	let mut bytes = Zeroizing::new(Vec::with_capacity(2 * 1024 * 1024 + 1));
	let mut chunk = Zeroizing::new([0u8; 8192]);
	loop {
		cancel.heartbeat()?;
		let mut descriptor =
			libc::pollfd { fd: libc::STDIN_FILENO, events: libc::POLLIN, revents: 0 };
		// SAFETY: descriptor points to one initialized pollfd for this bounded poll.
		let ready = unsafe { libc::poll(&raw mut descriptor, 1, 50) };
		if ready < 0 {
			if std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted {
				continue;
			}
			return Err(fail("Cannot read Blindfold stdin"));
		}
		if ready == 0 {
			continue;
		}
		if descriptor.revents & (libc::POLLERR | libc::POLLNVAL) != 0 {
			return Err(fail("Cannot read Blindfold stdin"));
		}
		cancel.heartbeat()?;
		// SAFETY: chunk owns a writable byte buffer of exactly the supplied length.
		let count = unsafe { libc::read(libc::STDIN_FILENO, chunk.as_mut_ptr().cast(), chunk.len()) };
		if count < 0 {
			if matches!(
				std::io::Error::last_os_error().kind(),
				std::io::ErrorKind::Interrupted | std::io::ErrorKind::WouldBlock
			) {
				continue;
			}
			return Err(fail("Cannot read Blindfold stdin"));
		}
		if count == 0 {
			break;
		}
		let count = count as usize;
		if bytes.len() + count > 2 * 1024 * 1024 {
			return Err(fail("Blindfold input exceeds 2 MiB"));
		}
		bytes.extend_from_slice(&chunk[..count]);
	}
	Ok(bytes)
}
#[cfg(not(unix))]
fn read_stdin(_cancel: &crate::task::CancelToken) -> Result<Zeroizing<Vec<u8>>> {
	Err(fail("Native Blindfold stdin is supported on Unix; use an input file on this platform"))
}
