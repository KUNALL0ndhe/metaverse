import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const target = process.env.REALTIME_URL ?? "http://localhost:8080";

/**
 * Inline the entry JS and CSS into index.html. If the page loads, the whole app loads —
 * no separate asset requests for ad-blockers, in-app browsers or flaky mobile data to drop.
 */
function inlineAssets(): Plugin {
  return {
    name: "inline-assets",
    apply: "build",
    enforce: "post",
    generateBundle(_, bundle) {
      const html = bundle["index.html"];
      if (!html || html.type !== "asset") return;
      let src = String(html.source);
      for (const [name, item] of Object.entries(bundle)) {
        if (item.type === "chunk" && item.isEntry) {
          const tag = `<script type="module" crossorigin src="/${name}"></script>`;
          if (!src.includes(tag)) continue;
          src = src.replace(tag, () => `<script type="module">${item.code.replace(/<\/script/gi, "<\\/script")}</script>`);
          delete bundle[name];
        } else if (item.type === "asset" && name.endsWith(".css")) {
          const tag = `<link rel="stylesheet" crossorigin href="/${name}">`;
          if (!src.includes(tag)) continue;
          src = src.replace(tag, () => `<style>${String(item.source)}</style>`);
          delete bundle[name];
        }
      }
      html.source = src;
    },
  };
}

export default defineConfig({
  plugins: [react(), inlineAssets()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/ws": { target, ws: true },
      "/api": target,
    },
  },
});
