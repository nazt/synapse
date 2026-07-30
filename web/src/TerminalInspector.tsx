import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { OracleCensus } from "./types";

// ── Terminal Inspector dock ───────────────────────────────────────────────
// The "see + act" half of the console. For a focused oracle it renders a REAL
// terminal (xterm.js) fed by a READ-ONLY `maw peek` snapshot (auto-refreshing),
// plus lifecycle actions: Wake/Spawn (maw wake, dry-run aware) and Add-to-team.
// Read-only preview + discrete actions — never a writable remote shell — which
// keeps it inside the board family's trust boundary.

const REFRESH_MS = 4000;
const PEEK_LINES = 160;

// maw peek emits \n-terminated lines; xterm needs \r\n to return the cursor.
function toCrlf(s: string): string {
  return s.replace(/\r?\n/g, "\r\n");
}

type WakeState = { ok: boolean; text: string; dryRun: boolean } | null;

export default function TerminalInspector({
  oracle,
  dryRun,
  activeTeamName,
  onAddToTeam,
  onClose,
}: {
  oracle: OracleCensus | null;
  dryRun: boolean;
  activeTeamName: string | undefined;
  onAddToTeam: (name: string) => void;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [peekErr, setPeekErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [waking, setWaking] = useState(false);
  const [wake, setWake] = useState<WakeState>(null);

  // The best `maw peek` target: precise pane id if present, else the session.
  const target = oracle ? oracle.pane || oracle.session : "";
  const isMock = oracle?.session === "mock" || !target;

  // Create the terminal ONCE and keep it across oracle changes (clear+rewrite
  // on refresh). Recreating per-oracle would flicker and leak.
  useEffect(() => {
    if (!hostRef.current || termRef.current) return;
    const term = new Terminal({
      convertEol: false,
      cursorBlink: false,
      disableStdin: true, // read-only preview — no keystrokes leave the box
      fontFamily:
        'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace',
      fontSize: 11.5,
      lineHeight: 1.15,
      scrollback: 2000,
      theme: {
        background: "#070a10",
        foreground: "#c7d2e0",
        cursor: "#070a10",
        selectionBackground: "rgba(100,181,246,0.3)",
        black: "#0a0e16",
        brightBlack: "#3a4761",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    try {
      fit.fit();
    } catch {
      /* container not laid out yet — next refresh fits */
    }
    termRef.current = term;
    fitRef.current = fit;
    return () => {
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  const peek = useCallback(async () => {
    const term = termRef.current;
    if (!term || !oracle) return;
    if (isMock) {
      term.clear();
      term.write(
        toCrlf(
          `\x1b[38;5;244m— ${oracle.name} —\x1b[0m\n` +
            `mock census (no live maw backend)\n` +
            `boot a real 'maw serve' + fleet to see live panes.\n`,
        ),
      );
      return;
    }
    setLoading(true);
    setPeekErr(null);
    try {
      const r = await fetch(
        `/api/synapse/peek?target=${encodeURIComponent(target)}&lines=${PEEK_LINES}`,
      );
      const j = (await r.json()) as {
        ok: boolean;
        output?: string;
        error?: string;
      };
      if (!j.ok) {
        setPeekErr(j.error ?? "peek failed");
        return;
      }
      // Fit before writing so wrapping matches the current dock width.
      try {
        fitRef.current?.fit();
      } catch {
        /* ignore */
      }
      term.clear();
      term.write(toCrlf(j.output ?? ""));
    } catch (e) {
      setPeekErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [oracle, target, isMock]);

  // Re-peek on oracle change + poll while open.
  useEffect(() => {
    if (!oracle) return;
    setWake(null);
    void peek();
    if (isMock) return;
    const id = setInterval(() => void peek(), REFRESH_MS);
    return () => clearInterval(id);
  }, [oracle, peek, isMock]);

  // Refit on window resize.
  useEffect(() => {
    const onResize = () => {
      try {
        fitRef.current?.fit();
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const doWake = useCallback(async () => {
    if (!oracle || isMock) return;
    setWaking(true);
    setWake(null);
    try {
      const r = await fetch("/api/synapse/wake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: oracle.session || oracle.name, dryRun }),
      });
      const j = (await r.json()) as {
        ok: boolean;
        command?: string;
        output?: string;
        error?: string;
        dryRun: boolean;
      };
      setWake({
        ok: j.ok,
        dryRun: j.dryRun,
        text: j.error ?? (j.output || j.command || (j.ok ? "ok" : "failed")),
      });
      if (j.ok && !j.dryRun) setTimeout(() => void peek(), 1200);
    } catch (e) {
      setWake({ ok: false, dryRun, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setWaking(false);
    }
  }, [oracle, dryRun, isMock, peek]);

  const dotColor =
    oracle?.status === "active"
      ? "#34e5b0"
      : oracle?.status === "idle"
        ? "#fbbf24"
        : "#8595a8";

  const open = Boolean(oracle);

  return (
    <div
      className="absolute bottom-4 left-4 z-20 w-[30rem] max-w-[calc(100vw-2rem)]"
      style={{
        transform: open ? "translateY(0)" : "translateY(140%)",
        opacity: open ? 1 : 0,
        pointerEvents: open ? "auto" : "none",
        transition: "transform 0.32s cubic-bezier(0.16,1,0.3,1), opacity 0.3s ease",
      }}
    >
      <div
        className="overflow-hidden rounded-xl border shadow-2xl"
        style={{
          background: "rgba(10,13,20,0.82)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderColor: "rgba(100,181,246,0.18)",
          boxShadow:
            "0 14px 44px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)",
        }}
      >
        {/* Title bar */}
        <div className="flex items-center gap-2.5 border-b border-white/5 px-3.5 py-2.5">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: dotColor, boxShadow: `0 0 8px ${dotColor}` }}
          />
          <span className="text-[13px] font-semibold tracking-tight text-neutral-100">
            {oracle?.name ?? ""}
          </span>
          <span className="font-mono text-[10.5px] uppercase tracking-wide text-neutral-500">
            {oracle?.status}
            {oracle && oracle.idleSec >= 0 ? ` · ${fmtIdle(oracle.idleSec)}` : ""}
          </span>
          {target && !isMock && (
            <span className="ml-auto truncate font-mono text-[10px] text-neutral-600">
              {target}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className={`${target && !isMock ? "" : "ml-auto"} shrink-0 rounded px-1.5 text-sm leading-none text-neutral-500 transition-colors hover:text-neutral-100`}
            title="close inspector"
          >
            ✕
          </button>
        </div>

        {/* Terminal */}
        <div className="relative" style={{ background: "#070a10" }}>
          <div
            ref={hostRef}
            className="h-[15rem] w-full px-2 py-1.5"
            style={{ contain: "strict" }}
          />
          {loading && (
            <span className="pointer-events-none absolute right-2 top-1.5 font-mono text-[10px] text-[#64b5f6]/70">
              ● live
            </span>
          )}
          {peekErr && (
            <div className="absolute inset-x-2 bottom-2 rounded bg-red-500/10 px-2 py-1 font-mono text-[10.5px] text-red-400">
              peek: {peekErr}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 border-t border-white/5 px-3 py-2.5">
          <button
            type="button"
            onClick={() => void peek()}
            disabled={isMock}
            className="rounded-md px-2.5 py-1 text-xs font-semibold text-neutral-200 transition-colors disabled:opacity-40"
            style={{ background: "rgba(255,255,255,0.06)" }}
            title="refresh snapshot"
          >
            ↻ Refresh
          </button>
          <button
            type="button"
            onClick={() => void doWake()}
            disabled={isMock || waking}
            className="rounded-md px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-40"
            style={{ background: "rgba(100,181,246,0.18)", color: "#8fd0ff" }}
            title={dryRun ? "preview wake (dry-run)" : "spawn / resume this oracle"}
          >
            {waking ? "…" : dryRun ? "◐ Wake (dry)" : "▲ Wake"}
          </button>
          {oracle && (
            <button
              type="button"
              onClick={() => onAddToTeam(oracle.name)}
              className="rounded-md px-2.5 py-1 text-xs font-semibold transition-colors"
              style={{ background: "rgba(52,229,176,0.15)", color: "#34e5b0" }}
              title={activeTeamName ? `add to «${activeTeamName}»` : "add to active team"}
            >
              ＋ {activeTeamName ? `«${activeTeamName}»` : "Team"}
            </button>
          )}
          {wake && (
            <span
              className="ml-auto truncate font-mono text-[10.5px]"
              style={{ color: wake.ok ? "#34e5b0" : "#ef4444" }}
              title={wake.text}
            >
              {wake.dryRun ? "dry: " : ""}
              {wake.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function fmtIdle(sec: number): string {
  if (sec < 0) return "";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}
