"use strict";

const ui = Object.fromEntries(["connect", "link", "status", "timer", "start", "stop", "speaker", "install", "copy"].map(id => [id, document.getElementById(id)]));
const storageKey = "xcsh.privateConnection";
let token = "";
try { token = location.hash.slice(1) || localStorage.getItem(storageKey) || ""; } catch { token = location.hash.slice(1); }
history.replaceState(null, "", location.pathname);
let socket, peer, microphone, channel, startedAt, clock, closing = false;

function storeToken(value) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Use the private connection link supplied for this host.");
  token = value;
  try { localStorage.setItem(storageKey, token); } catch { /* Private browsing can disable storage. */ }
  ui.connect.hidden = true;
  ui.copy.hidden = false;
}

function evidence(kind, value = {}) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "evidence", kind, value }));
}

function releaseMedia() {
  clearInterval(clock);
  microphone?.getTracks().forEach(track => track.stop());
  microphone = undefined;
  peer?.close();
  peer = undefined;
  ui.speaker.srcObject = null;
  ui.stop.hidden = true;
  ui.start.hidden = false;
  ui.start.disabled = false;
}

async function stopCall(reason = "Call ended.") {
  if (closing) return;
  closing = true;
  ui.status.textContent = reason;
  ui.stop.disabled = true;
  microphone?.getTracks().forEach(track => track.stop());
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "stop" }));
    // Keep listening for the provider closure until the host completes cleanup.
  } else releaseMedia();
}

async function gatherIce(connection) {
  if (connection.iceGatheringState === "complete") return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { connection.removeEventListener("icegatheringstatechange", changed); reject(new Error("Connection setup timed out.")); }, 15000);
    const changed = () => {
      if (connection.iceGatheringState === "complete") {
        clearTimeout(timeout);
        connection.removeEventListener("icegatheringstatechange", changed);
        resolve();
      }
    };
    connection.addEventListener("icegatheringstatechange", changed);
  });
}

async function startCall() {
  closing = false;
  ui.start.disabled = true;
  ui.status.textContent = "Starting your call…";
  try {
    storeToken(token);
    microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    peer = new RTCPeerConnection({ iceServers: [] });
    const connection = peer;
    microphone.getTracks().forEach(track => peer.addTrack(track, microphone));
    channel = peer.createDataChannel("oai-events");
    channel.onmessage = message => {
      try {
        const event = JSON.parse(message.data);
        if (event.type === "session.started" || event.type === "session.closed") evidence("provider", event);
      } catch { /* The server receives all protocol events independently. */ }
    };
    peer.ontrack = event => {
      ui.speaker.srcObject = event.streams[0] || new MediaStream([event.track]);
      ui.speaker.play().then(() => evidence("playback", { playing: true })).catch(() => {
        ui.status.textContent = "Tap here to hear the call.";
        ui.status.onclick = () => ui.speaker.play();
      });
    };
    peer.onconnectionstatechange = () => {
      evidence("connection", { state: connection.connectionState });
      if (connection.connectionState === "connected") ui.status.textContent = "Listening.";
      if (connection.connectionState === "failed" || connection.connectionState === "disconnected") stopCall("The call disconnected. Its capture has been saved.");
    };
    socket = new WebSocket(`wss://${location.host}/voice`, ["xcsh-voice", token]);
    socket.onmessage = async message => {
      try {
      const event = JSON.parse(message.data);
      if (closing) return;
      if (event.type === "ready") {
        await peer.setLocalDescription(await peer.createOffer());
        await gatherIce(peer);
        if (!closing) socket.send(JSON.stringify({ type: "start", sdp: peer.localDescription.sdp, clientInfo: navigator.userAgent }));
      } else if (event.type === "sdp") {
        await peer.setRemoteDescription({ type: "answer", sdp: event.sdp });
      } else if (event.type === "started") {
        startedAt = Date.now();
        ui.start.hidden = true;
        ui.stop.hidden = false;
        ui.stop.disabled = false;
        ui.timer.hidden = false;
        clock = setInterval(() => {
          const seconds = Math.floor((Date.now() - startedAt) / 1000);
          ui.timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
        }, 1000);
      } else if (event.type === "error") {
        ui.status.textContent = event.message;
        stopCall(event.message);
      }
      } catch (error) { stopCall(error.message); }
    };
    socket.onclose = () => {
      releaseMedia();
      if (!closing) ui.status.textContent = "Connection ended. Its capture has been saved.";
    };
    socket.onerror = () => { ui.connect.hidden = false; stopCall("Could not connect. Check Tailscale or paste your private connection link."); };
  } catch (error) {
    ui.status.textContent = error.message;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" }));
    releaseMedia();
  }
}

ui.copy.onclick = async () => {
  const link = `${location.origin}/#${token}`;
  try {
    await navigator.clipboard.writeText(link);
    ui.copy.textContent = "Connection link copied";
  } catch {
    ui.connect.hidden = false;
    ui.link.type = "text";
    ui.link.value = link;
    ui.link.select();
    ui.status.textContent = "Press and hold the link to copy it.";
  }
};
ui.start.onclick = startCall;
ui.stop.onclick = () => stopCall();
ui.connect.onsubmit = event => {
  event.preventDefault();
  try {
    const url = new URL(ui.link.value);
    if (url.origin !== location.origin) throw new Error("Use the connection link for this host.");
    storeToken(url.hash.slice(1));
    ui.start.disabled = false;
    ui.status.textContent = "Ready.";
    ui.link.value = "";
  } catch (error) { ui.status.textContent = error.message; }
};
window.addEventListener("pagehide", () => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" })); releaseMedia(); });
ui.install.hidden = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
try {
  storeToken(token);
  ui.status.textContent = "Ready.";
  ui.start.disabled = false;
} catch {
  ui.connect.hidden = false;
  ui.status.textContent = "Paste your private connection link to connect.";
}
