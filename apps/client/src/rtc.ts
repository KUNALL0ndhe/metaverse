/**
 * Proximity calls over a WebRTC mesh.
 *
 * - The peer with the lexicographically smaller id is the "initiator": it owns the connection
 *   lifecycle (connect / hang up) and is the only side that ever sends offers, so offers never collide.
 * - Every connection carries exactly one audio and one video transceiver. Turning the mic/camera on/off
 *   or sharing the screen swaps tracks with `replaceTrack`, which needs no renegotiation.
 */

type Signal =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "ice"; candidate: RTCIceCandidateInit }
  | { type: "bye" };

function iceServers(): RTCIceServer[] {
  const raw = import.meta.env.VITE_ICE_SERVERS;
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      console.warn("VITE_ICE_SERVERS is not valid JSON; falling back to public STUN");
    }
  }
  return [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
}

export interface Peer {
  id: string;
  pc: RTCPeerConnection;
  initiator: boolean;
  stream: MediaStream;
  audioEl: HTMLAudioElement;
  pendingIce: RTCIceCandidateInit[];
  state: RTCPeerConnectionState;
}

export class LocalMedia {
  mic: MediaStreamTrack | null = null;
  cam: MediaStreamTrack | null = null;
  screen: MediaStreamTrack | null = null;
  micOn = false;
  camOn = false;
  /** Stream used for the self-view (camera or screen). */
  readonly preview = new MediaStream();
  onChange: () => void = () => {};
  onTrack: (kind: "audio" | "video", track: MediaStreamTrack | null) => void = () => {};

  get videoTrack() {
    return this.screen ?? (this.camOn ? this.cam : null);
  }

  async setMic(on: boolean) {
    if (on && !this.mic) {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.mic = s.getAudioTracks()[0]!;
      this.onTrack("audio", this.mic);
    }
    if (this.mic) this.mic.enabled = on;
    this.micOn = on && !!this.mic;
    this.onChange();
  }

  async setCam(on: boolean) {
    if (on && !this.cam) {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 }, facingMode: "user" },
      });
      this.cam = s.getVideoTracks()[0]!;
    }
    if (!on && this.cam) {
      // Fully release the camera so the hardware light goes off.
      this.cam.stop();
      this.cam = null;
    }
    this.camOn = on && !!this.cam;
    this.syncVideo();
  }

  async startScreen() {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
    this.screen = s.getVideoTracks()[0]!;
    this.screen.addEventListener("ended", () => this.stopScreen());
    this.syncVideo();
  }

  stopScreen() {
    this.screen?.stop();
    this.screen = null;
    this.syncVideo();
  }

  private syncVideo() {
    for (const t of this.preview.getVideoTracks()) this.preview.removeTrack(t);
    const v = this.videoTrack;
    if (v) this.preview.addTrack(v);
    this.onTrack("video", v);
    this.onChange();
  }

  stopAll() {
    for (const t of [this.mic, this.cam, this.screen]) t?.stop();
    this.mic = this.cam = this.screen = null;
    this.micOn = this.camOn = false;
  }
}

export class PeerManager {
  readonly peers = new Map<string, Peer>();
  onChange: () => void = () => {};

  constructor(
    private selfId: string,
    private media: LocalMedia,
    private sendSignal: (to: string, data: Signal) => void,
  ) {
    media.onTrack = (kind, track) => {
      for (const p of this.peers.values()) {
        const tx = this.transceiver(p, kind);
        tx?.sender.replaceTrack(track).catch(() => {});
      }
    };
  }

  isInitiator(otherId: string) {
    return this.selfId < otherId;
  }

  /** Called every frame with the set of players we should be talking to (only acted on as initiator). */
  sync(wanted: Set<string>) {
    for (const id of wanted) if (this.isInitiator(id) && !this.peers.has(id)) void this.call(id);
    for (const id of this.peers.keys()) {
      if (this.isInitiator(id) && !wanted.has(id)) this.hangup(id, true);
    }
  }

  private createPeer(id: string, initiator: boolean): Peer {
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    const audioEl = new Audio();
    audioEl.autoplay = true;
    const peer: Peer = { id, pc, initiator, stream: new MediaStream(), audioEl, pendingIce: [], state: "new" };
    audioEl.srcObject = peer.stream;

    pc.onicecandidate = (e) => {
      if (e.candidate) this.sendSignal(id, { type: "ice", candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      for (const t of peer.stream.getTracks()) if (t.kind === e.track.kind) peer.stream.removeTrack(t);
      peer.stream.addTrack(e.track);
      audioEl.play().catch(() => {});
      this.onChange();
    };
    pc.onconnectionstatechange = () => {
      peer.state = pc.connectionState;
      if (pc.connectionState === "failed" && initiator) pc.restartIce();
      this.onChange();
    };
    pc.onnegotiationneeded = async () => {
      if (!initiator) return;
      try {
        await pc.setLocalDescription();
        this.sendSignal(id, { type: "offer", sdp: pc.localDescription!.sdp });
      } catch (err) {
        console.warn("negotiation failed", err);
      }
    };
    this.peers.set(id, peer);
    this.onChange();
    return peer;
  }

  private async call(id: string) {
    const peer = this.createPeer(id, true);
    peer.pc.addTransceiver(this.media.mic ?? "audio", { direction: "sendrecv" });
    peer.pc.addTransceiver(this.media.videoTrack ?? "video", { direction: "sendrecv" });
  }

  private transceiver(p: Peer, kind: "audio" | "video") {
    return p.pc.getTransceivers().find((t) => t.receiver.track.kind === kind && t.currentDirection !== "stopped");
  }

  hangup(id: string, notify: boolean) {
    const p = this.peers.get(id);
    if (!p) return;
    if (notify) this.sendSignal(id, { type: "bye" });
    p.pc.close();
    p.audioEl.srcObject = null;
    this.peers.delete(id);
    this.onChange();
  }

  private queue: Promise<void> = Promise.resolve();

  /** Signals are processed strictly in order so ICE never races its description. */
  onSignal(from: string, data: Signal) {
    this.queue = this.queue.then(() => this.handleSignal(from, data)).catch((e) => console.warn("signal error", e));
  }

  private async handleSignal(from: string, data: Signal) {
    if (data.type === "bye") {
      this.hangup(from, false);
      return;
    }
    let peer = this.peers.get(from);

    if (data.type === "offer") {
      // Only non-initiators accept offers.
      if (this.isInitiator(from)) return;
      if (!peer) peer = this.createPeer(from, false);
      const pc = peer.pc;
      await pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
      for (const t of pc.getTransceivers()) {
        const kind = t.receiver.track.kind as "audio" | "video";
        t.direction = "sendrecv";
        await t.sender.replaceTrack(kind === "audio" ? this.media.mic : this.media.videoTrack);
      }
      await pc.setLocalDescription();
      this.sendSignal(from, { type: "answer", sdp: pc.localDescription!.sdp });
      this.flushIce(peer);
      return;
    }
    if (!peer) return;
    if (data.type === "answer") {
      if (peer.pc.signalingState !== "have-local-offer") return;
      await peer.pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
      this.flushIce(peer);
    } else if (data.type === "ice") {
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
      else peer.pendingIce.push(data.candidate);
    }
  }

  private flushIce(p: Peer) {
    for (const c of p.pendingIce.splice(0)) p.pc.addIceCandidate(c).catch(() => {});
  }

  setVolume(id: string, v: number) {
    const p = this.peers.get(id);
    if (p) p.audioEl.volume = Math.max(0, Math.min(1, v));
  }

  closeAll() {
    for (const id of [...this.peers.keys()]) this.hangup(id, true);
  }
}
