"""Linux installed-RPC experiment; all raw evidence stays owner-only."""

from __future__ import annotations

import array
import asyncio
import hashlib
import json
import math
import os
import pathlib
import random
import sqlite3
import struct
import time
import uuid
from fractions import Fraction
from http import HTTPStatus
from types import SimpleNamespace
from typing import Any

import aiohttp
from aiortc import (
    MediaStreamTrack,
    RTCConfiguration,
    RTCPeerConnection,
    RTCSessionDescription,
)
from aiortc.mediastreams import MediaStreamError
from av import AudioFrame, FFmpegError
from qualification_exec import command_output, run_command
from voice_ab_capture import ConnectProxy, PacketCapture
from voice_ab_network import ADDRESS, INTERFACE, launch as namespace_launch

BURST_SECONDS = 0.7
PCM16_BYTES = 2
SIGNAL_RMS_THRESHOLD = 32

ROOT = pathlib.Path.home() / "xcsh-uat-lab/voice-ab-20261018"
os.umask(0o077)


def sha(value: Any) -> Any:
    """Compute a SHA256 digest."""
    return hashlib.sha256(
        value if isinstance(value, bytes) else value.encode()
    ).hexdigest()


def file_sha(path: Any) -> Any:
    """Perform file sha."""
    h = hashlib.sha256()
    with pathlib.Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1048576), b""):
            h.update(block)
    return h.hexdigest()


def seeded_burst_pcm(pts: Any, amplitude: Any = 1500, samples: Any = 960) -> Any:
    """Perform seeded burst pcm."""
    generator = random.Random(pts)  # noqa: S311 - deterministic PCM fixture, never security material
    phase = (pts / 48000) % 3
    envelope = (
        max(0.0, math.sin(math.pi * phase / BURST_SECONDS)) ** 2
        if phase < BURST_SECONDS
        else 0.01
    )
    return b"".join(
        struct.pack("<h", int(generator.randint(-amplitude, amplitude) * envelope))
        for _ in range(samples)
    )


class Recording:
    """Maintain Recording qualification state."""

    def __init__(self, path: Any) -> None:
        """Initialize qualification state."""
        self.path = path
        self.stream = path.open("x")
        self.sequence = 0
        self.rows: list[Any] = []
        self.append("collector_armed")

    def append(self, stage: Any, **values: Any) -> Any:
        """Perform append."""
        self.sequence += 1
        row = {
            "sequence": self.sequence,
            "atUnixNs": time.time_ns(),
            "stage": stage,
            **values,
        }
        self.rows.append(row)
        self.stream.write(json.dumps(row) + "\n")
        self.stream.flush()

    def close(self) -> Any:
        """Perform close."""
        self.append("collector_footer", complete=True)
        self.stream.close()
        return {
            "sha256": sha(self.path.read_bytes()),
            "complete": True,
            "count": self.sequence,
        }


class RPC:
    """Maintain RPC qualification state."""

    reader: Any
    writer: Any

    backend: Any
    pending: Any
    record: Any
    notifications: Any
    error_stream: Any
    candidate: Any
    proc: Any
    pump: Any

    async def connect(self, directory: Any, backend: Any, environment: Any) -> Any:
        """Perform connect."""
        self.initialize_connection(directory, backend, environment)
        if backend == "codex":
            binary = os.environ.get(
                "VOICE_AB_NATIVE_BINARY",
                str(ROOT / "release-bin/codex-x86_64-unknown-linux-musl"),
            )
            self.candidate = {
                "commit": "83086188ae0614bd882818ff1aa23f3194962012",
                "executable": binary,
                "sha256": file_sha(binary),
            }
            command = [binary, "app-server", "--stdio"]
            debug_socket = None
            if os.environ.get("VOICE_AB_GDB") == "1":
                debug_socket = directory / "debug.sock"
                command = [
                    "/usr/bin/gdb",
                    "-q",
                    "-batch",
                    "-x",
                    str(ROOT / "gdb-trace.private.commands"),
                    "--args",
                    binary,
                    "app-server",
                    "--listen",
                    "unix://" + str(debug_socket),
                ]
            if os.environ.get("VOICE_AB_NAMESPACE") == "1":
                command = namespace_launch(command, environment, directory)
            self.proc = await asyncio.create_subprocess_exec(
                *command,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=self.error_stream,
                env=environment,
                cwd=directory / "project",
                start_new_session=True,
            )
            if debug_socket:
                for _ in range(600):
                    if debug_socket.exists():
                        break
                    await asyncio.sleep(0.05)
                self.reader, self.writer = await asyncio.open_unix_connection(
                    str(debug_socket)
                )
            else:
                self.reader, self.writer = self.proc.stdout, self.proc.stdin
        else:
            agent = directory / "agent"
            (agent / "remote-control/workers").mkdir(parents=True, mode=0o700)
            snapshots = {}
            for name in ("agent.db", "models.db"):
                db = sqlite3.connect(
                    (pathlib.Path.home() / ".xcsh/agent" / name).as_uri() + "?mode=ro",
                    uri=True,
                )
                target = sqlite3.connect(agent / name)
                db.backup(target)
                target.close()
                db.close()
                snapshots[name] = sha((agent / name).read_bytes())
            self.record.append("real_configuration_cloned", databaseSha256=snapshots)
            environment["PI_CODING_AGENT_DIR"] = str(agent)
            environment["XCSH_REMOTE_TRACE_DIRECTORY"] = str(directory / "traces")
            environment["XCSH_REMOTE_TRACE_SCENARIO"] = "native-ab-startup"
            environment["XCSH_REMOTE_TRACE_SALT"] = os.urandom(32).hex()
            environment["XCSH_VOICE_UAT_DIRECTORY"] = str(directory / "diagnostics")
            environment["XCSH_VOICE_UAT_SCENARIO"] = "native-ab-startup"
            path = agent / "remote-control/workers/attempt.sock"
            baseline = json.loads(
                pathlib.Path(
                    os.environ.get(
                        "VOICE_AB_XCSH_CANDIDATE", str(ROOT / "baseline.private.json")
                    )
                ).read_text()
            )
            self.candidate = baseline["candidate"]
            ensure(
                file_sha(self.candidate["executable"]) == self.candidate["sha256"],
                ("installed candidate hash mismatch"),
            )
            command = [
                baseline["candidate"]["executable"],
                "remote-control",
                "worker",
                str(path),
            ]
            if os.environ.get("VOICE_AB_NAMESPACE") == "1":
                command = namespace_launch(command, environment, directory)
            self.proc = await asyncio.create_subprocess_exec(
                *command,
                stderr=self.error_stream,
                stdout=self.error_stream,
                env=environment,
                cwd=directory / "project",
                start_new_session=True,
            )
            for _ in range(200):
                if path.exists():
                    break
                if self.proc.returncode is not None:
                    message = "installed worker startup failed"
                    raise RuntimeError(message)
                await asyncio.sleep(0.05)
            self.reader, self.writer = await asyncio.open_unix_connection(str(path))
        if os.environ.get("VOICE_AB_NAMESPACE") == "1":
            # The sudo monitor is root-owned; prove the actual namespace inferior.
            code = """import pathlib,subprocess,json,sys,time
expected=pathlib.Path(sys.argv[1]);found=[]
for _ in range(40):
 for pid in command_output(["ip","netns","pids","voice-ab-20261018"],text=True).split():
  try:
   p=pathlib.Path("/proc",pid)
   if (p/"exe").resolve()==expected:
    found.append(dict(pid=int(pid),executable=str(expected),startTime=(p/"stat").read_text().split(") ",1)[1].split()[19],uid=p.stat().st_uid))
  except FileNotFoundError:pass
 if found:break
 time.sleep(.05)
assert found,"expected namespace executable not observed"
print(json.dumps(found))"""
            expected = (
                binary if backend == "codex" else baseline["candidate"]["executable"]
            )
            observed = json.loads(
                command_output(
                    ["/usr/bin/sudo", "-n", "/usr/bin/python3", "-c", code, expected],
                    text=True,
                )
            )
            self.record.append(
                "process_started",
                monitorPid=self.proc.pid,
                backend=backend,
                processes=observed,
            )
        else:
            self.record.append(
                "process_started",
                pid=self.proc.pid,
                backend=backend,
                executable=str(
                    pathlib.Path("/proc", str(self.proc.pid), "exe").resolve()
                ),
            )
        self.pump = asyncio.create_task(self.read())

    async def read(self) -> Any:
        """Perform read."""
        try:
            while raw := await self.reader.readline():
                value = json.loads(raw)
                self.record.append("rpc_received", message=value)
                if value.get("id") in self.pending and (
                    "result" in value or "error" in value
                ):
                    self.pending.pop(value["id"]).set_result(value)
                elif value.get("method"):
                    message = value.get("params", {}).get("event", value)
                    self.notifications.append(message)
                    if "id" in value:
                        result = (
                            {"ack": value.get("params", {}).get("seq")}
                            if self.backend == "xcsh"
                            else {}
                        )
                        self.writer.write(
                            (
                                json.dumps({"id": value["id"], "result": result}) + "\n"
                            ).encode()
                        )
                        await self.writer.drain()
        except (OSError, ValueError, RuntimeError):
            for future in self.pending.values():
                if not future.done():
                    future.set_exception(RuntimeError("RPC capture ended"))

    async def call(self, method: Any, params: Any, sensitive: Any = False) -> Any:
        """Perform call."""
        ident = uuid.uuid4().hex
        future = asyncio.get_running_loop().create_future()
        self.pending[ident] = future
        self.record.append(
            "rpc_sent",
            method=method,
            params={"type": params.get("type"), "credentialValuesOmitted": True}
            if sensitive
            else params,
        )
        self.writer.write(
            (
                json.dumps({"id": ident, "method": method, "params": params}) + "\n"
            ).encode()
        )
        await self.writer.drain()
        response = await asyncio.wait_for(future, 90)
        if "error" in response:
            message = (
                "RPC rejected " + method + ": " + str(response["error"].get("code"))
            )
            raise RuntimeError(message)
        return response.get("result", {})

    async def session(self, method: Any, params: Any) -> Any:
        """Perform session."""
        if self.backend == "codex":
            return await self.call(method, params)
        result = await self.call(
            "worker/sessionCall",
            {"identity": uuid.uuid4().hex, "method": method, "params": params},
        )
        return result["result"]

    async def close(self) -> Any:
        """Perform close."""
        if hasattr(self, "writer"):
            self.writer.close()
        if hasattr(self, "proc") and self.proc.returncode is None:
            if os.environ.get("VOICE_AB_NAMESPACE") == "1":
                run_command(
                    [
                        "/usr/bin/sudo",
                        "-n",
                        "kill",
                        "-TERM",
                        "--",
                        "-" + str(self.proc.pid),
                    ],
                    check=True,
                )
            else:
                self.proc.terminate()
            try:
                await asyncio.wait_for(self.proc.wait(), 15)
            except TimeoutError:
                self.proc.kill()
                await self.proc.wait()
        if hasattr(self, "pump"):
            await asyncio.gather(self.pump, return_exceptions=True)
        self.error_stream.close()
        return self.record.close()

    def initialize_connection(
        self, directory: Any, backend: Any, environment: Any
    ) -> None:
        """Initialize owned RPC state before backend-specific connection setup."""
        self.backend = backend
        self.pending: dict[str, Any] = {}
        self.record = Recording(directory / "rpc.private.jsonl")
        self.notifications: list[Any] = []
        self.error_stream = (directory / "backend.private.log").open("w")


class CallerAudio(MediaStreamTrack):
    """Maintain CallerAudio qualification state."""

    kind = "audio"

    def __init__(self) -> None:
        """Initialize qualification state."""
        super().__init__()
        self.pts = 0
        self.started: float | None = None
        self.digest = hashlib.sha256()

    async def recv(self) -> Any:
        """Perform recv."""
        if self.started is None:
            self.started = time.monotonic()
        await asyncio.sleep(max(0, self.started + self.pts / 48000 - time.monotonic()))
        data = seeded_burst_pcm(self.pts)
        self.digest.update(data)
        frame = AudioFrame(format="s16", layout="mono", samples=960)
        frame.sample_rate = 48000
        frame.pts = self.pts
        frame.time_base = Fraction(1, 48000)
        frame.planes[0].update(data.ljust(frame.planes[0].buffer_size, b"\0"))
        self.pts += 960
        return frame


async def config_read() -> Any:
    """Perform config read."""
    reader, writer = await asyncio.open_unix_connection(
        str(pathlib.Path.home() / ".xcsh/agent/remote-control/host.sock")
    )

    async def call(method: Any, params: Any) -> Any:
        """Perform call."""
        ident = uuid.uuid4().hex
        writer.write(
            (
                json.dumps(
                    {
                        "id": ident,
                        "method": "protocol",
                        "params": {
                            "request": {"id": ident, "method": method, "params": params}
                        },
                    }
                )
                + "\n"
            ).encode()
        )
        await writer.drain()
        while raw := await reader.readline():
            row = json.loads(raw)
            if row.get("id") == ident:
                if "error" in row:
                    message = "installed config read rejected"
                    raise RuntimeError(message)
                return row["result"]["result"]
            if row.get("method") == "protocol/event":
                writer.write(
                    (json.dumps({"id": row["id"], "result": {}}) + "\n").encode()
                )
                await writer.drain()
        message = "configuration transport ended"
        raise RuntimeError(message)

    try:
        await call(
            "initialize",
            {
                "clientInfo": {"name": "voice_ab_config", "version": "1"},
                "capabilities": {"experimentalApi": True},
            },
        )
        return await call("config/read", {"includeLayers": True})
    finally:
        writer.close()
        await writer.wait_closed()


async def finalize_probe(capture_state: Any) -> None:
    """Close provider and collectors, preserve receipts, remove staged credentials."""
    capture_state.result["notifications"] = (
        [n.get("method") for n in capture_state.rpc.notifications]
        if hasattr(capture_state.rpc, "notifications")
        else []
    )
    if capture_state.call_id and not capture_state.server_closed:
        try:
            async with (
                aiohttp.ClientSession(
                    timeout=aiohttp.ClientTimeout(total=15)
                ) as capture_state.http,
                capture_state.http.ws_connect(
                    "wss://api.openai.com/v1/live/" + capture_state.call_id,
                    headers=capture_state.headers,
                    proxy=capture_state.proxy.url,
                ) as capture_state.ws,
            ):
                await capture_state.ws.send_json({"type": "session.close"})
                capture_state.deadline = time.monotonic() + 5
                while time.monotonic() < capture_state.deadline:
                    capture_state.msg = await asyncio.wait_for(
                        capture_state.ws.receive(), 1
                    )
                    if (
                        capture_state.msg.type == aiohttp.WSMsgType.TEXT
                        and json.loads(capture_state.msg.data).get("type")
                        == "session.closed"
                    ):
                        capture_state.server_closed = True
                        break
                    if capture_state.msg.type in (
                        aiohttp.WSMsgType.CLOSED,
                        aiohttp.WSMsgType.ERROR,
                    ):
                        break
        except (OSError, ValueError, RuntimeError, aiohttp.ClientError) as error:
            capture_state.result["cleanupErrorType"] = type(error).__name__
    await capture_state.pc.close()
    for _iteration_value in capture_state.consumers:
        capture_state.task = _iteration_value
        capture_state.task.cancel()
    await asyncio.gather(*capture_state.consumers, return_exceptions=True)
    if hasattr(capture_state.rpc, "candidate"):
        capture_state.result["candidate"] = capture_state.rpc.candidate
    if hasattr(capture_state.rpc, "record"):
        capture_state.result["rpcCapture"] = await capture_state.rpc.close()
    await capture_state.proxy.close()
    capture_state.result["packets"] = await capture_state.packet.close()
    if capture_state.sideband_packet:
        capture_state.result[
            "sidebandPackets"
        ] = await capture_state.sideband_packet.close()
    capture_state.result.update(
        startupAudio=capture_state.output,
        inputSamples=capture_state.caller.pts,
        inputSha256=capture_state.caller.digest.hexdigest(),
        serverClosureConfirmed=capture_state.server_closed,
        primaryCapture=capture_state.wire.close(),
        mediaCapture=capture_state.media.close(),
        lifecycleCapture=capture_state.lifecycle.close(),
        directory=str(capture_state.directory),
    )
    # Runtime auth and cloned credential DBs are staging, never evidence artifacts.
    for _iteration_value in (
        capture_state.directory / "agent",
        capture_state.directory / "codex-home",
    ):
        capture_state.parent = _iteration_value
        for _iteration_value in (
            "auth.json",
            "agent.db",
            "agent.db-wal",
            "agent.db-shm",
            "models.db",
            "models.db-wal",
            "models.db-shm",
        ):
            capture_state.name = _iteration_value
            (capture_state.parent / capture_state.name).unlink(missing_ok=True)
    (capture_state.directory / "result.private.json").write_text(
        json.dumps(capture_state.result, indent=2) + "\n"
    )
    print(
        json.dumps(
            {
                k: v
                for k, v in capture_state.result.items()
                if k
                in (
                    "backend",
                    "directory",
                    "failureType",
                    "failureMessage",
                    "creationStatus",
                    "startupAudio",
                    "serverClosureConfirmed",
                    "configuredInstructionsSha256",
                    "creationInstructionsSha256",
                )
            }
        ),
        flush=True,
    )


async def initialize_probe_resources(capture_state: Any, material: Any) -> None:
    """Arm owned packet, wire and media collectors before call creation."""
    capture_state.wire = Recording(capture_state.directory / "primary.private.jsonl")
    capture_state.media = Recording(capture_state.directory / "media.private.jsonl")
    capture_state.lifecycle = Recording(
        capture_state.directory / "lifecycle.private.jsonl"
    )
    capture_state.proxy = ConnectProxy(capture_state.directory)
    await capture_state.proxy.start()
    capture_state.packet = PacketCapture()
    await capture_state.packet.start(capture_state.directory, capture_state.proxy.port)
    capture_state.sideband_packet = None
    if os.environ.get("VOICE_AB_NAMESPACE") == "1":
        capture_state.sideband_packet = PacketCapture()
        await capture_state.sideband_packet.start(
            capture_state.directory,
            interface=INTERFACE,
            name="sideband",
            capture_filter=["host", ADDRESS, "and", "tcp", "port", "443"],
        )
    capture_state.rpc = RPC()
    capture_state.pc = RTCPeerConnection(RTCConfiguration(iceServers=[]))
    capture_state.caller = CallerAudio()
    capture_state.pc.addTrack(capture_state.caller)
    capture_state.channel = capture_state.pc.createDataChannel("oai-events")
    capture_state.output = {"frames": 0, "signalFrames": 0, "maxRms": 0}
    capture_state.consumers = []
    capture_state.call_id = None
    capture_state.thread_id = None
    capture_state.server_closed = False
    capture_state.headers = {
        "Authorization": "Bearer " + material["accessToken"],
        "ChatGPT-Account-Id": material["accountId"],
        "originator": "xcsh",
        "openai-alpha": "quicksilver=v2",
    }


async def run(backend: Any, policy: Any, material: Any, index: Any) -> Any:
    """Perform run."""
    capture_state = SimpleNamespace()
    # Linux sockaddr_un permits at most 107 pathname bytes, including parent paths.
    capture_state.directory = ROOT / (
        "a" + str(index) + "-" + backend + "-" + str(time.time_ns() % 1000000000)
    )
    capture_state.directory.mkdir(mode=0o700)
    for _iteration_value in ("project", "traces", "diagnostics", "codex-home"):
        capture_state.name = _iteration_value
        (capture_state.directory / capture_state.name).mkdir(mode=0o700)
    await initialize_probe_resources(capture_state, material)

    @capture_state.channel.on("message")
    def on_message(value: Any) -> Any:
        """Perform on message."""
        event = json.loads(value)
        capture_state.wire.append("primary_event", event=event)
        if event.get("type") == "session.closed":
            capture_state.server_closed = True

    @capture_state.pc.on("connectionstatechange")
    async def state_change() -> Any:
        """Perform state change."""
        capture_state.lifecycle.append(
            "media_state", state=capture_state.pc.connectionState
        )

    @capture_state.pc.on("track")
    def track_received(track: Any) -> Any:
        """Perform track received."""

        async def consume() -> Any:
            """Perform consume."""
            try:
                while True:
                    frame = await track.recv()
                    validate_pcm_frame(frame)
                    count = frame.samples * (
                        1 if frame.format.is_planar else len(frame.layout.channels)
                    )
                    samples = array.array("h", bytes(frame.planes[0])[: count * 2])
                    rms = (
                        math.sqrt(sum(v * v for v in samples) / len(samples))
                        if samples
                        else 0
                    )
                    capture_state.output["frames"] += 1
                    capture_state.output["signalFrames"] += int(
                        rms > SIGNAL_RMS_THRESHOLD
                    )
                    capture_state.output["maxRms"] = max(
                        capture_state.output["maxRms"], round(rms)
                    )
                    capture_state.media.append(
                        "output_audio",
                        rms=round(rms),
                        signalFrames=int(rms > SIGNAL_RMS_THRESHOLD),
                    )
            except (
                OSError,
                ValueError,
                RuntimeError,
                MediaStreamError,
                FFmpegError,
            ) as error:
                capture_state.media.append(
                    "audio_track_ended", errorType=type(error).__name__
                )

        capture_state.consumers.append(asyncio.create_task(consume()))

    capture_state.result = {
        "backend": backend,
        "scope": "installed-worker-startup" if backend == "xcsh" else "native-startup",
        "physicalAcceptance": False,
        "phoneRequestVisible": False,
        "creationInstructionBytes": len(policy.encode()),
        "creationInstructionsSha256": sha(policy),
        "model": "gpt-6-astra",
        "effort": "high",
        "voiceModel": "gpt-live-1-codex",
        "voice": "cove",
        "accountSha256": sha(material["accountId"]),
        "rootCauseEstablished": False,
    }
    capture_state.result["nativeBuild"] = (
        "source-debug" if os.environ.get("VOICE_AB_NATIVE_BINARY") else "stock-release"
    )
    capture_state.result["debuggerInstrumented"] = os.environ.get("VOICE_AB_GDB") == "1"
    try:
        capture_state.environment = dict(
            os.environ,
            HTTPS_PROXY=capture_state.proxy.url,
            HTTP_PROXY=capture_state.proxy.url,
            ALL_PROXY=capture_state.proxy.url,
            NO_PROXY="localhost,127.0.0.1",
            CODEX_HOME=str(capture_state.directory / "codex-home"),
            RUST_LOG="codex_api=trace,codex_core::realtime_conversation=debug",
        )
        (capture_state.directory / "codex-home/config.toml").write_text(
            'model = "gpt-6-astra"\nmodel_reasoning_effort = "high"\n'
            "experimental_realtime_ws_backend_prompt = " + json.dumps(policy) + "\n"
        )
        await capture_state.rpc.connect(
            capture_state.directory, backend, capture_state.environment
        )
        await configure_probe_thread(capture_state, backend, material)
        capture_state.lifecycle.append(
            "thread_created", threadId=capture_state.thread_id
        )
        capture_state.result["configuredInstructionsSha256"] = sha(
            capture_state.config["config"].get(
                "experimental_realtime_ws_backend_prompt"
            )
            or ""
        )
        await capture_state.pc.setLocalDescription(await capture_state.pc.createOffer())
        capture_state.body = {
            "sdp": capture_state.pc.localDescription.sdp,
            "session": {
                "model": "gpt-live-1-codex",
                "instructions": policy,
                "audio": {"output": {"voice": "cove"}},
                "delegation": {"type": "client"},
            },
        }
        capture_state.lifecycle.append(
            "prompt_selected",
            instructionsSha256=sha(policy),
            bytes=len(policy.encode()),
        )
        await perform_webrtc_probe(capture_state)
    except Exception as error:  # pylint: disable=broad-exception-caught
        # Retain any failed diagnostic candidate and finalize all armed collectors.
        capture_state.result["failureType"] = type(error).__name__
        capture_state.result["failureMessage"] = str(error)[:150]
        capture_state.lifecycle.append("attempt_failed", errorType=type(error).__name__)
    finally:
        await finalize_probe(capture_state)
    return capture_state.result


async def main() -> Any:
    """Perform main."""
    material_path = ROOT / "auth-material.private.json"
    material = json.loads(material_path.read_text())
    material_path.unlink()
    config = await config_read()
    policy = config["config"].get("experimental_realtime_ws_backend_prompt")
    ensure(
        isinstance(policy, str) and policy.strip(),
        ("installed creation policy unavailable"),
    )
    (ROOT / "bootstrap-config.private.json").write_text(
        json.dumps(config, indent=2) + "\n"
    )
    results = []
    for index, backend in enumerate(("codex", "xcsh", "xcsh", "codex"), 1):
        results.append(await run(backend, policy, material, index))
    (ROOT / ("installed-abba-" + str(time.time_ns()) + ".private.json")).write_text(
        json.dumps(results, indent=2) + "\n"
    )


def ensure(condition: object, message: str) -> None:
    """Enforce a qualification invariant even when Python optimization is enabled."""
    if not condition:
        raise AssertionError(message)


def validate_pcm_frame(frame: Any) -> None:
    """Reject an output frame that does not carry PCM16 samples."""
    if frame.format.bytes != PCM16_BYTES:
        message = "non-PCM16 output"
        raise RuntimeError(message)


def validate_creation_status(status: int) -> None:
    """Require successful creation before accepting any call evidence."""
    if status != HTTPStatus.CREATED:
        message = "call creation rejected"
        raise RuntimeError(message)


def validate_call_identity(call_id: str, location: str) -> None:
    """Require both opaque call identity and provider location."""
    if not call_id or not location:
        message = "call identity unavailable"
        raise RuntimeError(message)


async def configure_probe_thread(
    capture_state: Any, backend: Any, material: Any
) -> None:
    """Run a bounded probe phase while retaining its private evidence bindings."""
    if backend == "codex":
        await capture_state.rpc.call(
            "initialize",
            {
                "clientInfo": {"name": "voice_ab", "version": "1"},
                "capabilities": {"experimentalApi": True},
            },
        )
        await capture_state.rpc.call(
            "account/login/start",
            {
                "type": "chatgptAuthTokens",
                "accessToken": material["accessToken"],
                "chatgptAccountId": material["accountId"],
            },
            sensitive=True,
        )
        capture_state.account = await capture_state.rpc.call(
            "account/read", {"refreshToken": False}
        )
        capture_state.lifecycle.append("account_read", account=capture_state.account)
        capture_state.config = await capture_state.rpc.call(
            "config/read", {"includeLayers": True}
        )
        capture_state.lifecycle.append(
            "configuration_read", configuration=capture_state.config
        )
        capture_state.thread = await capture_state.rpc.call(
            "thread/start",
            {
                "cwd": str(capture_state.directory / "project"),
                "model": "gpt-6-astra",
                "modelProvider": "openai",
                "experimentalRawEvents": True,
            },
        )
        capture_state.thread_id = capture_state.thread["thread"]["id"]
    else:
        capture_state.config = await config_read()
        capture_state.lifecycle.append(
            "configuration_read", configuration=capture_state.config
        )
        capture_state.initialized = await capture_state.rpc.call(
            "worker/initialize",
            {
                "request": {
                    "kind": "start",
                    "params": {
                        "cwd": str(capture_state.directory / "project"),
                        "model": "gpt-6-astra",
                        "modelProvider": "openai-codex",
                        "effort": "high",
                    },
                }
            },
        )
        capture_state.thread_id = capture_state.initialized["endpoint"]["thread"]["id"]


async def perform_webrtc_probe(capture_state: Any) -> None:
    """Run a bounded probe phase while retaining its private evidence bindings."""
    async with aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(total=45)
    ) as capture_state.http:
        async with capture_state.http.post(
            "https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas",
            headers={**capture_state.headers, "Content-Type": "application/json"},
            json=capture_state.body,
            proxy=capture_state.proxy.url,
            allow_redirects=False,
        ) as capture_state.response:
            capture_state.result["creationStatus"] = capture_state.response.status
            validate_creation_status(capture_state.response.status)
            capture_state.location = capture_state.response.headers.get(
                "Location", ""
            ).split("?")[0]
            capture_state.call_id = capture_state.location.rstrip("/").split("/")[-1]
            validate_call_identity(capture_state.call_id, capture_state.location)
            capture_state.lifecycle.append(
                "call_created",
                callId=capture_state.call_id,
                responseHeaderNames=sorted(capture_state.response.headers.keys()),
            )
            capture_state.answer = await capture_state.response.text()
        await capture_state.pc.setRemoteDescription(
            RTCSessionDescription(sdp=capture_state.answer, type="answer")
        )
        capture_state.lifecycle.append("media_activated", callId=capture_state.call_id)
        await capture_state.rpc.session(
            "thread/realtime/start",
            {
                "threadId": capture_state.thread_id,
                "version": "v3",
                "outputModality": "audio",
                "includeStartupContext": False,
                "realtimeSessionId": str(uuid.uuid4()),
                "transport": {"type": "existingCall", "callId": capture_state.call_id},
            },
        )
        capture_state.lifecycle.append("realtime_start_accepted")
        await asyncio.sleep(14)
        await capture_state.rpc.session(
            "thread/realtime/stop", {"threadId": capture_state.thread_id}
        )
        capture_state.lifecycle.append(
            "local_close_requested", reason="diagnostic-duration-ended"
        )
        await asyncio.sleep(2)
        try:
            capture_state.history = await capture_state.rpc.session(
                "thread/read",
                {"threadId": capture_state.thread_id, "includeTurns": True},
            )
            (capture_state.directory / "history.private.json").write_text(
                json.dumps(capture_state.history, indent=2) + "\n"
            )
        except (OSError, ValueError, RuntimeError, aiohttp.ClientError) as error:
            capture_state.result["historyErrorType"] = type(error).__name__
        capture_state.result["notifications"] = [
            n.get("method") for n in capture_state.rpc.notifications
        ]


if __name__ == "__main__":
    asyncio.run(main())
