import { Elysia, t } from "elysia";
import { join, normalize } from "node:path";
import { tmpdir } from "node:os";
import { statSync } from "node:fs";

const PORT = Number(process.env.PORT ?? 3001);

// Directory holding the built web SPA (web/dist). Overridable via env.
const WEB_DIST = process.env.WEB_DIST ?? join(import.meta.dir, "..", "web", "dist");
const INDEX_HTML = join(WEB_DIST, "index.html");

// Directory holding detached-run logfiles (.synapse/<name>.log), written by the
// CLI's spawnDetached. server/ is one level down, so `.synapse` is a sibling of
// the repo root — resolve from import.meta.dir up one level.
const SYNAPSE_DIR = process.env.SYNAPSE_DIR ?? join(import.meta.dir, "..", ".synapse");

// --- SSE log streaming (#161) -------------------------------------------
// The maw <cmd> stdio problem: `maw synapse dev|serve` DETACH the server and
// write its output to .synapse/<name>.log — maw itself can never stream a
// long-running child (it pipes stdio + blocks on .output()). So instead of
// fighting stdout, we tail the logfile over SSE and let the CLIENT do the
// reading (`curl -N` or a browser EventSource).
//
// Pattern reused from Stoa's /stream: one SharedTail per logfile (Map keyed by
// absolute path) fanning completed lines out to all subscribers; a monotonic
// event id + a small ring buffer for Last-Event-ID replay; a 15s heartbeat
// comment; a concurrent-client cap; and teardown of the tailer once its last
// subscriber leaves.

const RING_CAP = 256; // lines retained for Last-Event-ID replay
const POLL_MS = 300; // logfile poll interval
const HEARTBEAT_MS = 15_000; // SSE keep-alive comment interval
const MAX_SSE_CLIENTS = 24; // global concurrent-client cap

type Subscriber = { send: (id: number, line: string) => void };
type RingEntry = { id: number; line: string };

// A per-logfile tailer. Polls the file for appended bytes, buffers partial
// lines, and broadcasts each completed line (with a monotonic id) to every
// subscriber. Seeds its ring from the file's existing tail so a fresh client
// gets recent context immediately.
class LogTailer {
  private offset = 0; // byte offset consumed so far
  private buf = ""; // partial (unterminated) trailing line
  private nextId = 1;
  private ring: RingEntry[] = [];
  private subs = new Set<Subscriber>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly path: string,
    private readonly onEmpty: () => void,
  ) {}

  private record(line: string): number {
    const id = this.nextId++;
    this.ring.push({ id, line });
    if (this.ring.length > RING_CAP) this.ring.shift();
    return id;
  }

  // Prime offset + ring from the file that already exists on disk.
  async seed(): Promise<void> {
    let size = 0;
    try {
      size = statSync(this.path).size;
    } catch {
      this.offset = 0;
      return;
    }
    if (size === 0) {
      this.offset = 0;
      return;
    }
    const text = await Bun.file(this.path).text();
    this.offset = size;
    const parts = text.split("\n");
    this.buf = parts.pop() ?? ""; // trailing partial line (no newline yet)
    // Anchor ids to the file's absolute line ordinal (1-based) — a DURABLE
    // anchor (line count) rather than a volatile counter — so ids stay stable
    // across process restarts: line k of the file is always id k, no matter
    // when the tailer (re)starts or how much of the tail the ring retains.
    // `parts` holds every completed line; the ring keeps only the last
    // RING_CAP, but each retained line carries its true position as its id, so
    // a client reconnecting with a pre-restart Last-Event-ID still resumes.
    const start = Math.max(0, parts.length - RING_CAP);
    this.nextId = start + 1;
    for (const raw of parts.slice(start)) {
      this.record(stripCr(raw));
    }
    // nextId now === parts.length + 1 — the ordinal of the next appended line.
  }

  ensureRunning(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.poll();
    }, POLL_MS);
  }

  private async poll(): Promise<void> {
    let size: number;
    try {
      size = statSync(this.path).size;
    } catch {
      return; // file not present yet (or gone) — try again next tick
    }
    if (size < this.offset) {
      // truncated / rotated — restart from the top
      this.offset = 0;
      this.buf = "";
    }
    if (size <= this.offset) return;
    const text = await Bun.file(this.path).slice(this.offset, size).text();
    this.offset = size;
    this.buf += text;
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = stripCr(this.buf.slice(0, idx));
      this.buf = this.buf.slice(idx + 1);
      const id = this.record(line);
      for (const s of this.subs) s.send(id, line);
    }
  }

  // Register a subscriber, replaying any buffered lines newer than lastEventId.
  // A fresh connection with no/NaN Last-Event-ID replays the ENTIRE ring (up to
  // RING_CAP seeded lines) as real id:/data: events before live tailing — this
  // is intentional context priming. Consumers that must distinguish history
  // from new appends should track Last-Event-ID (each event carries a stable
  // id:) and send it on reconnect, rather than assuming every data: event is a
  // brand-new append.
  addSub(sub: Subscriber, lastEventId?: number): void {
    const from = Number.isFinite(lastEventId) ? (lastEventId as number) : 0;
    for (const e of this.ring) {
      if (e.id > from) sub.send(e.id, e.line);
    }
    this.subs.add(sub);
  }

  removeSub(sub: Subscriber): void {
    this.subs.delete(sub);
    if (this.subs.size === 0) this.stop();
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.onEmpty();
  }
}

function stripCr(s: string): string {
  return s.endsWith("\r") ? s.slice(0, -1) : s;
}

const tailers = new Map<string, LogTailer>();

async function getTailer(path: string): Promise<LogTailer> {
  let t = tailers.get(path);
  if (!t) {
    t = new LogTailer(path, () => tailers.delete(path));
    await t.seed();
    t.ensureRunning();
    tailers.set(path, t);
  }
  return t;
}

// Only [A-Za-z0-9._-] names map to a logfile — blocks path traversal and any
// separator. Returns null for anything else.
function sanitizeLogName(name: string | undefined): string | null {
  const n = (name ?? "dev").trim();
  return /^[A-Za-z0-9._-]+$/.test(n) ? n : null;
}

let sseClientCount = 0;

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
      // Preview only — the temp file at `${file}` is NOT written in dryRun
      // (Bun.write is guarded below). Prefix a shell comment so the shown
      // command, if copy-pasted verbatim, is an inert no-op rather than a
      // real invocation pointing at a non-existent file.
      results.push({
        member,
        command: `# dry-run preview (temp file written only on real send): ${command}`,
        message,
        ok: true,
      });
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
  // SSE log stream (#161). Tails .synapse/<name>.log (default dev) and pushes
  // each completed line as an SSE event (`id:` = monotonic line id). Supports
  // Last-Event-ID replay from a 256-line ring, a 15s heartbeat comment, and a
  // concurrent-client cap. Live tail: `curl -N .../stream?name=dev`.
  .get(
    "/api/synapse/stream",
    async ({ query, request, set }) => {
      const name = sanitizeLogName(query.name);
      if (!name) {
        set.status = 400;
        return { ok: false, error: "invalid name (expected [A-Za-z0-9._-])" };
      }
      if (sseClientCount >= MAX_SSE_CLIENTS) {
        set.status = 503;
        return { ok: false, error: `too many clients (max ${MAX_SSE_CLIENTS})` };
      }

      const logPath = join(SYNAPSE_DIR, `${name}.log`);
      const lastHeader = request.headers.get("last-event-id");
      const lastEventId = lastHeader ? Number.parseInt(lastHeader, 10) : NaN;

      const encoder = new TextEncoder();
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let sub: Subscriber | null = null;
      let tailer: LogTailer | null = null;
      let closed = false;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (tailer && sub) tailer.removeSub(sub);
        sseClientCount--;
      };

      sseClientCount++;
      request.signal.addEventListener("abort", cleanup);

      const stream = new ReadableStream({
        async start(controller) {
          const enqueue = (chunk: string) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(chunk));
            } catch {
              // controller already closed by the runtime — drop.
            }
          };

          enqueue(`: connected to ${name}.log\n\n`);

          sub = {
            send: (id, line) => enqueue(`id: ${id}\ndata: ${line}\n\n`),
          };
          tailer = await getTailer(logPath);
          tailer.addSub(sub, lastEventId);

          heartbeat = setInterval(() => enqueue(`: ping ${Date.now()}\n\n`), HEARTBEAT_MS);
        },
        cancel() {
          cleanup();
        },
      });

      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        },
      });
    },
    {
      query: t.Object({
        name: t.Optional(t.String()),
      }),
    },
  )
  // Nodes for the graph board. Shells out to `maw census --json`; on any
  // failure or empty result, returns a small mock so the UI still renders.
  .get("/api/synapse/census", async () => {
    const oracles = await runMawCensus();
    if (oracles.length === 0) {
      return { ok: true, mock: true, oracles: CENSUS_MOCK };
    }
    return { ok: true, mock: false, oracles };
  })
  // Team fan-out. Body { members: string[], dryRun?: boolean }. FAIL-SAFE: the
  // server DEFAULTS to dryRun=true — it constructs but does NOT send, returning
  // the planned { member, command, message } list. A live fan-out requires an
  // EXPLICIT opt-out: body `dryRun:false` (or `?dryRun=false` / `?dryRun=0`).
  // A malformed/hand-rolled client that omits the flag gets a preview, never a
  // real send — the safety default lives server-side, matching the UI toggle.
  .post(
    "/api/synapse/team",
    async ({ body, query }) => {
      const members = [...new Set(body.members.map((m) => m.trim()).filter(Boolean))];
      if (members.length === 0) {
        return { ok: false, error: "no members", sent: [], dryRun: true };
      }
      // Default TRUE. Only an explicit falsey signal (body dryRun:false, or
      // query dryRun=false/0) unlocks a real send; anything else stays a preview.
      const dryRun =
        body.dryRun ?? !(query.dryRun === "false" || query.dryRun === "0");
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
