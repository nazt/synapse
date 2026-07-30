import { Elysia, t } from "elysia";
import { join, normalize } from "node:path";
import { tmpdir } from "node:os";

const PORT = Number(process.env.PORT ?? 3001);

// Directory holding the built web SPA (web/dist). Overridable via env.
const WEB_DIST = process.env.WEB_DIST ?? join(import.meta.dir, "..", "web", "dist");
const INDEX_HTML = join(WEB_DIST, "index.html");

// --- Census (nodes = oracles) -------------------------------------------
// Shape returned by `maw census --json`:
//   { schema, displays: [ { name, spaces: [ { name, oracles: [ ... ] } ] } ] }
// Each oracle: { oracle, session, pane, modelTier, status, idleSec, annotation, pinned }

type OracleNodeData = {
  name: string;
  status: string;
  host: string;
  session: string;
  idleSec: number;
};

type RawOracle = {
  oracle?: unknown;
  session?: unknown;
  status?: unknown;
  idleSec?: unknown;
  annotation?: unknown;
};

// A tiny mock so the UI still renders when census is unavailable/empty.
const CENSUS_MOCK: OracleNodeData[] = [
  { name: "neo", status: "active", host: "fleet: neo", session: "mock", idleSec: 0 },
  { name: "digger", status: "active", host: "fleet: digger", session: "mock", idleSec: 0 },
  { name: "maw-rs", status: "idle", host: "fleet: maw-rs", session: "mock", idleSec: 42 },
  { name: "noah", status: "stale", host: "fleet: noah", session: "mock", idleSec: 45000 },
  { name: "pulse", status: "stale", host: "fleet: pulse", session: "mock", idleSec: 84000 },
];

function flattenCensus(raw: unknown): OracleNodeData[] {
  const out: OracleNodeData[] = [];
  const seen = new Set<string>();
  const displays = (raw as { displays?: unknown })?.displays;
  if (!Array.isArray(displays)) return out;
  for (const display of displays) {
    const spaces = (display as { spaces?: unknown })?.spaces;
    if (!Array.isArray(spaces)) continue;
    for (const space of spaces) {
      const oracles = (space as { oracles?: unknown })?.oracles;
      if (!Array.isArray(oracles)) continue;
      for (const o of oracles as RawOracle[]) {
        const name = typeof o.oracle === "string" ? o.oracle : "";
        if (!name || seen.has(name)) continue;
        seen.add(name);
        out.push({
          name,
          status: typeof o.status === "string" ? o.status : "unknown",
          host: typeof o.annotation === "string" ? o.annotation : "",
          session: typeof o.session === "string" ? o.session : "",
          idleSec: typeof o.idleSec === "number" ? o.idleSec : -1,
        });
      }
    }
  }
  return out;
}

async function runMawCensus(): Promise<OracleNodeData[]> {
  try {
    const proc = Bun.spawn(["maw", "census", "--json"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    if (proc.exitCode !== 0 || !stdout.trim()) return [];
    const parsed = JSON.parse(stdout);
    return flattenCensus(parsed);
  } catch {
    return [];
  }
}

// --- Team fan-out --------------------------------------------------------
// Builds an INVITE-TONE message (Rule 6 / reunion — announce, never command)
// that names the FULL team, writes it to a temp file, and delivers it to each
// member via `maw hey <member> -f <file>` (bytes-through: dodges the
// bracket-trap and the backtick/$/quote shell-escape scars).

function buildInviteMessage(members: string[]): string {
  const list = members.join(", ");
  // MUST NOT start with '[' — `maw hey` rejects a bracket-prefixed body
  // (it auto-signs a federation tag). A leading emoji/word is safe.
  return `เราเป็นทีมเดียวกันแล้วครับ 🔗 สมาชิก: ${list} — สร้างทีมนี้จาก Synapse`;
}

type SentEntry = {
  member: string;
  command: string;
  message: string;
  ok: boolean;
  error?: string;
};

async function fanOutTeam(
  members: string[],
  dryRun: boolean,
): Promise<SentEntry[]> {
  const message = buildInviteMessage(members);

  // One temp file, shared across members (same team message for everyone).
  const file = join(
    tmpdir(),
    `synapse-team-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`,
  );
  if (!dryRun) {
    await Bun.write(file, message);
  }

  const results: SentEntry[] = [];
  for (const member of members) {
    const command = `maw hey ${member} -f ${file}`;
    if (dryRun) {
      results.push({ member, command, message, ok: true });
      continue;
    }
    try {
      const proc = Bun.spawn(["maw", "hey", member, "-f", file], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stderr] = await Promise.all([
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      const ok = proc.exitCode === 0;
      results.push({
        member,
        command,
        message,
        ok,
        ...(ok ? {} : { error: stderr.trim() || `exit ${proc.exitCode}` }),
      });
    } catch (err) {
      results.push({
        member,
        command,
        message,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

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
  // Nodes for the graph board. Shells out to `maw census --json`; on any
  // failure or empty result, returns a small mock so the UI still renders.
  .get("/api/synapse/census", async () => {
    const oracles = await runMawCensus();
    if (oracles.length === 0) {
      return { ok: true, mock: true, oracles: CENSUS_MOCK };
    }
    return { ok: true, mock: false, oracles };
  })
  // Team fan-out. Body { members: string[], dryRun?: boolean }. When dryRun is
  // true (or ?dryRun=true), constructs but does NOT send — returns the planned
  // { member, command, message } list. Default (no flag) sends for real.
  .post(
    "/api/synapse/team",
    async ({ body, query }) => {
      const members = [...new Set(body.members.map((m) => m.trim()).filter(Boolean))];
      if (members.length === 0) {
        return { ok: false, error: "no members", sent: [], dryRun: true };
      }
      const dryRun =
        body.dryRun ?? (query.dryRun === "true" || query.dryRun === "1");
      const sent = await fanOutTeam(members, dryRun);
      return { ok: sent.every((s) => s.ok), sent, dryRun };
    },
    {
      body: t.Object({
        members: t.Array(t.String()),
        dryRun: t.Optional(t.Boolean()),
      }),
      query: t.Object({
        dryRun: t.Optional(t.String()),
      }),
    },
  )
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
