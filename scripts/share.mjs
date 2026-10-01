/**
 * Put your local world on the internet with a free Cloudflare quick tunnel (no account needed).
 *
 *   pnpm share
 *
 * Starts the production server and prints a public https://….trycloudflare.com link.
 * The link works while this terminal is running; it changes every time you restart.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PORT ?? "8080";
const MAX_ATTEMPTS = 4;

function findCloudflared() {
  const candidates = [
    process.env.CLOUDFLARED,
    "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
    "C:\\Program Files\\cloudflared\\cloudflared.exe",
    "/opt/homebrew/bin/cloudflared",
    "/usr/local/bin/cloudflared",
    "/usr/bin/cloudflared",
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? "cloudflared"; // fall back to PATH
}

const server = spawn(process.execPath, [join(root, "apps/realtime/dist/index.js")], {
  env: { ...process.env, PORT },
  stdio: ["ignore", "inherit", "inherit"],
});

let tunnel = null;
let stopping = false;

function startTunnel(attempt) {
  console.log(`🛰️  Opening Cloudflare tunnel${attempt > 1 ? ` (attempt ${attempt}/${MAX_ATTEMPTS})` : ""}…`);
  // HTTP/2 over TCP works on networks that block QUIC/UDP (common on mobile & ISP connections).
  const t = spawn(findCloudflared(), ["tunnel", "--no-autoupdate", "--protocol", "http2", "--url", `http://localhost:${PORT}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  tunnel = t;
  let url = "";
  let live = false;

  const scan = (buf) => {
    for (const line of buf.toString().split("\n")) {
      const m = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) url = m[0];
      if (!live && url && line.includes("Registered tunnel connection")) {
        live = true;
        console.log(`\n🌍 Your world is live at:\n\n    ${url}\n\nShare it with anyone. Keep this terminal open — Ctrl+C to stop.\n`);
      } else if (/ ERR /.test(line) && !stopping) {
        console.warn(`   cloudflared: ${line.replace(/^\S+\s+ERR\s+/, "").trim()}`);
      }
    }
  };
  t.stdout.on("data", scan);
  t.stderr.on("data", scan);

  t.on("error", (e) => {
    console.error(
      e.code === "ENOENT"
        ? "❌ cloudflared not found. Install it: `winget install Cloudflare.cloudflared` (Windows) or `brew install cloudflared` (macOS)."
        : `❌ ${e.message}`,
    );
    shutdown(1);
  });
  t.on("exit", () => {
    if (stopping) return;
    if (attempt < MAX_ATTEMPTS) {
      console.warn("⚠️  Tunnel dropped — retrying in 3s…");
      setTimeout(() => startTunnel(attempt + 1), 3000);
    } else {
      console.error("❌ Couldn't open a Cloudflare tunnel. Check your internet connection and try again.");
      shutdown(1);
    }
  });
}

startTunnel(1);
server.on("exit", (code) => shutdown(code ?? 0));

function shutdown(code) {
  if (stopping) return;
  stopping = true;
  server.kill();
  tunnel?.kill();
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
