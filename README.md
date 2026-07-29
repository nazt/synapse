# Synapse

> Drag-connect graph board — a **maw serve** plugin.

Synapse is a two-package monorepo that mounts under `maw serve`. A Bun/Elysia
server exposes a health endpoint and serves the built React SPA; a Vite +
React 19 + Tailwind v4 web app provides the board UI.

**Status:** Commit 1 — runnable scaffold only. `bun run dev` boots cleanly, a
blank page renders, and `/health` returns `ok`. No drag-connect graph yet.

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
