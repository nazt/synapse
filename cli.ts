// maw plugin CLI entry — enables `maw synapse <serve|dev|build|status|stop>`.
// Contract: maw EXECUTES this file (it does not import it), passing subcommand
// args as process.argv; it captures stdout via a blocking .output() and prints
// only after the process exits. So maw <cmd> is strictly run-once-and-exit —
// a long-running server can NEVER stream through it (confirmed by maw-rs:
// dispatch_bun_dev_plugin hardcodes Stdio::piped() + .output()).
//
// Therefore serve/dev DETACH the server and return immediately with the URL +
// a logfile to tail — never block. Live dev logs: `bun run dev` in a terminal,
// or (persistent) mount via engine.serve and `maw serve`.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";

type InvokeContext = { source?: string; args?: string[]; writer?: (...args: unknown[]) => void };
type InvokeResult = { ok: boolean; output?: string; error?: string };

export const command = {
  name: "synapse",
  description: "Synapse — drag-connect graph board (maw-serve plugin).",
};

const ROOT = dirname(fileURLToPath(import.meta.url));
const RUN_DIR = join(ROOT, ".synapse");

function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 0));
  });
}

function spawnDetached(cmd: string, args: string[], name: string): number {
  mkdirSync(RUN_DIR, { recursive: true });
  const logPath = join(RUN_DIR, `${name}.log`);
  const fd = openSync(logPath, "a");
  const child = spawn(cmd, args, {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", fd, fd],
    env: process.env,
  });
  child.unref();
  if (child.pid) writeFileSync(join(RUN_DIR, `${name}.pid`), String(child.pid));
  return child.pid ?? -1;
}

function usage(): InvokeResult {
  return {
    ok: false,
    output: [
      "usage: maw synapse <serve|dev|build|status|stop>",
      "  serve   build web, then run the production server DETACHED (Elysia serves web/dist)",
      "  dev     run server + Vite dev DETACHED (hot reload)",
      "  build   build the web SPA into web/dist (blocking, streams)",
      "  status  fetch the running server's /status (real liveness)",
      "  stop    stop a detached serve/dev started by this CLI",
      "",
      "note: maw <cmd> cannot stream a long-running server (maw-rs: piped stdio + blocking .output).",
      "      serve/dev detach and log to .synapse/<name>.log. For LIVE logs run `bun run dev` directly,",
      "      or mount via engine.serve and start `maw serve` (→ http://<host>:3456/api/synapse/).",
    ].join("\n"),
  };
}

function stopByPidfile(name: string): string {
  const pidfile = join(RUN_DIR, `${name}.pid`);
  if (!existsSync(pidfile)) return `${name}: not running (no pidfile)`;
  const pid = Number(readFileSync(pidfile, "utf8").trim());
  if (!Number.isFinite(pid)) return `${name}: bad pidfile`;
  try {
    process.kill(-pid, "SIGTERM"); // negative = the detached process group
    return `${name}: stopped (pid ${pid})`;
  } catch {
    try {
      process.kill(pid, "SIGTERM");
      return `${name}: stopped (pid ${pid})`;
    } catch {
      return `${name}: already gone (pid ${pid})`;
    }
  }
}

export async function runSynapse(args: string[]): Promise<InvokeResult> {
  const sub = (args[0] ?? "").toLowerCase();
  const port = process.env.PORT ?? "3001";
  try {
    if (!sub || sub === "help" || sub === "--help" || sub === "-h") return usage();

    if (sub === "build") {
      const code = await run("bun", ["run", "build"]);
      return code === 0
        ? { ok: true, output: "synapse build: web/dist ready" }
        : { ok: false, error: `web build failed (${code})` };
    }

    if (sub === "serve") {
      const built = await run("bun", ["run", "build"]);
      if (built !== 0) return { ok: false, error: `web build failed (${built})` };
      const pid = spawnDetached("bun", ["run", "start"], "serve");
      return {
        ok: true,
        output: [
          `synapse serve: detached (pid ${pid})`,
          `  url:  http://localhost:${port}/`,
          `  logs: tail -f ${join(RUN_DIR, "serve.log")}`,
          `  stop: maw synapse stop`,
        ].join("\n"),
      };
    }

    if (sub === "dev") {
      const pid = spawnDetached("bun", ["run", "dev"], "dev");
      return {
        ok: true,
        output: [
          `synapse dev: detached (pid ${pid})`,
          `  web:  http://localhost:5173/  (Vite, hot reload)`,
          `  api:  http://localhost:${port}/  (Elysia)`,
          `  logs: tail -f ${join(RUN_DIR, "dev.log")}`,
          `  stop: maw synapse stop`,
          "",
          "  (for live logs in your terminal instead, run: bun run dev)",
        ].join("\n"),
      };
    }

    if (sub === "status") {
      try {
        const res = await fetch(`http://localhost:${port}/status`);
        const body = (await res.json()) as unknown;
        return { ok: true, output: JSON.stringify(body, null, 2) };
      } catch {
        return { ok: false, error: `synapse not reachable on :${port} — start it with 'maw synapse serve'` };
      }
    }

    if (sub === "stop") {
      return { ok: true, output: [stopByPidfile("serve"), stopByPidfile("dev")].join("\n") };
    }

    return usage();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  return runSynapse(ctx.args ?? []);
}

// maw executes this entry file directly; run the handler when invoked as main.
if (import.meta.main) {
  const result = await runSynapse(process.argv.slice(2));
  if (result.output) console.log(result.output);
  if (!result.ok && result.error) {
    console.error(result.error);
    process.exit(1);
  }
}
