import { useCallback, useEffect, useMemo, useRef } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { OracleNodeType } from "./types";

// Status → color + label. Active pops (emerald), idle amber, offline calm slate
// — not alarming red. Red is reserved for real failures.
function statusMeta(status: string): {
  color: string;
  label: string;
  live: boolean;
} {
  if (status === "active")
    return { color: "#34e5b0", label: "active", live: true };
  if (status === "idle") return { color: "#fbbf24", label: "idle", live: true };
  return { color: "#8595a8", label: status || "offline", live: false };
}

// Compact idle age: 0s / 45s / 12m / 3h / 2d.
function fmtIdle(sec: number): string {
  if (sec < 0) return "";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

const HANDLE_STYLE = {
  width: 8,
  height: 8,
  background: "#0a0e16",
  border: "1.5px solid #64b5f6",
  boxShadow: "0 0 6px rgba(100,181,246,0.8)",
} as const;

const TILT_MAX = 8; // deg — subtle depth, not a toy

// Read reduced-motion once — tilt is decoration, gated off when motion is off.
const REDUCE =
  typeof matchMedia !== "undefined" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

function Corner({ pos, color }: { pos: string; color: string }) {
  const edges: Record<string, string> = {
    tl: "border-l border-t left-1.5 top-1.5",
    tr: "border-r border-t right-1.5 top-1.5",
    bl: "border-l border-b left-1.5 bottom-1.5",
    br: "border-r border-b right-1.5 bottom-1.5",
  };
  return <span className={`hud-corner ${edges[pos]}`} style={{ color }} />;
}

export default function OracleNode({ data }: NodeProps<OracleNodeType>) {
  const { color, label, live } = statusMeta(data.status);
  const { armed, stage, teamColors, teamColor } = data;
  const idle = fmtIdle(data.idleSec);

  // Accent drives border, glow, corner brackets. Staged nodes take the ACTIVE
  // team's color; armed takes amber; otherwise the status color.
  const accent =
    armed ? "#f59e0b" : stage === "on" ? (teamColor ?? "#64b5f6") : color;

  // Hover-tilt: pointer position → CSS vars on the inner card, rAF-throttled.
  // NEVER via React state — that would re-render the whole node per mouse move.
  const cardRef = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const onMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (REDUCE) return;
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      el.style.setProperty("--rx", `${(-py * 2 * TILT_MAX).toFixed(2)}deg`);
      el.style.setProperty("--ry", `${(px * 2 * TILT_MAX).toFixed(2)}deg`);
    });
  }, []);
  const onLeave = useCallback(() => {
    cancelAnimationFrame(raf.current);
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // Stable per-node drift clock so nodes don't breathe in lockstep.
  const phase = useMemo(() => {
    let h = 0;
    for (const c of data.name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
    return h;
  }, [data.name]);

  const cardStyle: React.CSSProperties = {
    minWidth: 178,
    cursor: "pointer",
    background:
      "linear-gradient(158deg, rgba(24,30,44,0.72) 0%, rgba(10,13,20,0.82) 100%)",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    border: `1px solid ${
      armed
        ? "rgba(245,158,11,0.6)"
        : stage === "on"
          ? accent
          : "rgba(100,181,246,0.16)"
    }`,
    boxShadow: armed
      ? "0 0 0 1px rgba(245,158,11,0.35), inset 0 1px 0 rgba(255,255,255,0.05)"
      : "0 6px 20px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)",
    // Custom props consumed by index.css for the depth compositor.
    ["--accent" as string]: accent,
    ["--drift-delay" as string]: `${-(phase % 12)}s`,
    ["--drift-dur" as string]: `${9 + (phase % 5)}s`,
  };

  return (
    // OUTER = perspective frame. Owns pointer + the depth stage. No visuals.
    <div
      className="oracle-persp"
      data-stage={stage}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      {/* INNER = the card. translateZ + tilt + scale compose here (index.css). */}
      <div
        ref={cardRef}
        className="oracle-card group relative select-none overflow-hidden rounded-lg px-3.5 py-2.5 text-neutral-100"
        style={cardStyle}
        title="click to connect — tap another oracle to link them"
      >
        {/* HUD corner brackets */}
        <Corner pos="tl" color={accent} />
        <Corner pos="tr" color={accent} />
        <Corner pos="bl" color={accent} />
        <Corner pos="br" color={accent} />

        {/* top hairline sheen */}
        <span
          className="pointer-events-none absolute inset-x-3 top-0 h-px"
          style={{
            background: `linear-gradient(90deg, transparent, ${accent}66, transparent)`,
          }}
        />

        {/* drift wrapper — the "alive" motion, inner content only */}
        <div className="oracle-drift">
          <div className="flex items-center gap-2.5">
            {/* status ring */}
            <span className="relative flex h-3 w-3 shrink-0 items-center justify-center">
              {live && (
                <span
                  className="hud-ping absolute inline-flex h-2.5 w-2.5 rounded-full"
                  style={{ background: color }}
                />
              )}
              <span
                className="relative inline-block h-2.5 w-2.5 rounded-full"
                style={{
                  background: color,
                  boxShadow: `0 0 10px ${color}, 0 0 2px ${color}`,
                }}
                aria-label={label}
              />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight">
              {data.name}
            </span>
            {/* team membership rings — one dot per team this oracle is in */}
            {teamColors.length > 0 && (
              <span className="flex shrink-0 items-center gap-1">
                {teamColors.map((c, i) => (
                  <span
                    key={`${c}-${i}`}
                    className="inline-block h-2 w-2 rounded-full"
                    style={{
                      background: c,
                      boxShadow: `0 0 5px ${c}`,
                      outline:
                        stage === "on" && c === teamColor
                          ? `1.5px solid #ffffffcc`
                          : "none",
                    }}
                  />
                ))}
              </span>
            )}
          </div>

          <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wide">
            <span style={{ color }}>{label}</span>
            {idle && <span className="text-neutral-600">/ {idle}</span>}
            {data.host && (
              <span className="ml-auto min-w-0 truncate lowercase text-neutral-500">
                {data.host.replace(/^fleet:\s*/, "")}
              </span>
            )}
          </div>

          {armed && (
            <div
              className="mt-1.5 font-mono text-[10px] uppercase tracking-wider"
              style={{ color: "#f59e0b" }}
            >
              ▸ click another to link
            </div>
          )}
        </div>
      </div>

      {/* Handles are SIBLINGS of the card, anchored to the perspective frame —
          they never drift/scale, so edge endpoints stay pinned. */}
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
    </div>
  );
}
