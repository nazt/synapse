import { Elysia } from "elysia";
import { join, normalize } from "node:path";

const PORT = Number(process.env.PORT ?? 3001);

// Directory holding the built web SPA (web/dist). Overridable via env.
const WEB_DIST = process.env.WEB_DIST ?? join(import.meta.dir, "..", "web", "dist");
const INDEX_HTML = join(WEB_DIST, "index.html");

const app = new Elysia()
  .get("/health", () => ({
    ok: true,
    service: "synapse",
    version: "0.1.0",
    ts: Date.now(),
  }))
  // Real liveness of THIS process. Distinct from the manifest-declared health
  // path (/api/synapse/health), which `maw serve` answers itself without
  // proxying — so /status is what actually proves the synapse process is up
  // when mounted under maw. (See maw-rs serve_plugin_proxy.rs.)
  .get("/status", () => ({
    ok: true,
    service: "synapse",
    version: "0.1.0",
    uptimeMs: Math.round(performance.now()),
    prefix: process.env.MAW_ENGINE_SERVE_PREFIX ?? null,
    ts: Date.now(),
  }))
  // Serve the built SPA. Static assets resolve to real files; everything
  // else falls back to index.html so client-side routing works.
  .get("/*", async ({ params, set }) => {
    const rel = params["*"] ?? "";
    const candidate = normalize(join(WEB_DIST, rel));

    // Guard against path traversal outside WEB_DIST.
    if (candidate !== WEB_DIST && !candidate.startsWith(WEB_DIST + "/")) {
      set.status = 403;
      return "Forbidden";
    }

    if (rel) {
      const asset = Bun.file(candidate);
      if (await asset.exists()) {
        return asset;
      }
    }

    const fallback = Bun.file(INDEX_HTML);
    if (await fallback.exists()) {
      return fallback;
    }

    set.status = 404;
    return { ok: false, error: "web build not found — run `bun run build`" };
  })
  .listen(PORT);

console.log(`Synapse server listening on http://localhost:${app.server?.port}`);
