import type { ClientMsg, ServerMsg } from "@repo/world";

type Handler = (msg: ServerMsg) => void;

export class Net {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  onOpen: () => void = () => {};
  onClose: () => void = () => {};

  connect() {
    const url = import.meta.env.VITE_WS_URL ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => this.onOpen();
    ws.onclose = () => {
      if (this.ws === ws) this.onClose();
    };
    ws.onmessage = (e) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      for (const h of this.handlers) h(msg);
    };
  }

  close() {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  get open() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMsg) {
    if (this.open) this.ws!.send(JSON.stringify(msg));
  }

  on(h: Handler) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }
}
