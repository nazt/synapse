# Synapse

> Drag-connect graph board — a **maw serve** plugin.

Synapse is a two-package monorepo that mounts under `maw serve`. A Bun/Elysia
server exposes a health endpoint and serves the built React SPA; a Vite +
React 19 + Tailwind v4 web app provides the board UI.

**Status:** #158 — drag-connect graph board. Nodes come from `maw census`
(each an `OracleNode` tile with a status orb + host); drag from one node's
handle to another (`@xyflow/react`) to draw an edge. Union-find over the drawn
edges groups nodes into teams; **Form Team** fans an invite-tone message out to
each member via `maw hey <member> -f <file>` (a dry-run toggle, default ON,
previews without sending).

## API

| Route | Purpose |
| ----- | ------- |
| `GET /api/synapse/census` | Shells `maw census --json`, flattens oracles → nodes. Falls back to a small mock if census is empty/unavailable. |
| `POST /api/synapse/team` | Body `{ members: string[], dryRun?: boolean }`. Writes an invite message to a temp file and delivers it to each member with `maw hey <member> -f <file>`. `dryRun` (body flag or `?dryRun=true`) returns the planned `{ member, command, message }` list without sending. Returns `{ ok, sent, dryRun }`. |

Two scars are designed around: `maw hey` rejects a body starting with `[` (it
auto-signs a federation tag), and it mangles backtick / `$` / double-quote in an
inline body — so the message is always written to a temp file and passed with
`-f` (bytes-through, no shell).

## Stack

| Layer   | Tech                                                        |
| ------- | ---------------------------------------------------------- |
| Runtime | Bun                                                        |
| Server  | Elysia                                                     |
| Web     | React 19, Vite, Tailwind v4 (`@tailwindcss/vite`), `@xyflow/react` |
| Lang    | TypeScript                                                 |

## Layout

```
synapse/
├─ plugin.json      # maw serve-plugin manifest (engine.serve)
├─ package.json     # root scripts: dev / build / start
├─ scripts/dev.ts   # Bun.spawn orchestrator (server + web in parallel)
├─ server/          # Elysia app — GET /health, serves web/dist SPA
└─ web/             # Vite + React 19 + Tailwind v4 SPA
```

## Quickstart

```bash
# Install every workspace
bun run install:all

# Dev — server (:3001) + web (:5173) in parallel
bun run dev

# Health check
curl -s localhost:3001/health

# Production build (web → web/dist, served by the server)
bun run build
bun run start
```

The web dev server proxies `/api` → `http://localhost:3001`.
Set `PORT` to change the server port; `WEB_DIST` to point at a different build dir.

## Plugin

`plugin.json` declares `engine.serve` so Synapse mounts under `maw serve` at the
prefix `/api/synapse` with health at `/health`.

---

_This project is AI-generated. Code, docs, and commits are authored by Claude
(Anthropic) working as the Neo Oracle builder, on behalf of Nat Weerawan
([@nazt](https://github.com/nazt)) and the laris.co team. AI never pretends to be
human — attribution is explicit (Rule 6: Transparency)._
