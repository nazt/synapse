import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { OracleNodeType } from "./types";

// Status → color + label. Active pops (emerald), idle amber, offline calm slate
// — not alarming red. Red is reserved for real failures.
function statusMeta(status: string): {
  color: string;
  label: string;
  live: boolean;
} {
  if (status === "active") return { color: "#34e5b0", label: "active", live: true };
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
  const armed = data.armed;
  const hi = data.highlighted;
  const idle = fmtIdle(data.idleSec);

  // Accent drives border, glow, corner brackets.
  const accent = armed ? "#f59e0b" : hi ? "#64b5f6" : color;
  const emphasized = armed || hi || live;

  return (
    <div
      className="group relative select-none overflow-hidden rounded-lg px-3.5 py-2.5 text-neutral-100 transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5"
      style={{
        minWidth: 178,
        cursor: "pointer",
        background:
          "linear-gradient(158deg, rgba(24,30,44,0.72) 0%, rgba(10,13,20,0.82) 100%)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        border: `1px solid ${armed ? "rgba(245,158,11,0.6)" : hi ? "rgba(100,181,246,0.6)" : "rgba(100,181,246,0.14)"}`,
        boxShadow: armed
          ? "0 0 0 1px rgba(245,158,11,0.35), 0 0 28px rgba(245,158,11,0.32), inset 0 1px 0 rgba(255,255,255,0.05)"
          : hi
            ? "0 0 0 1px rgba(100,181,246,0.4), 0 0 28px rgba(100,181,246,0.3), inset 0 1px 0 rgba(255,255,255,0.05)"
            : "0 6px 20px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)",
        opacity: emphasized ? 1 : 0.78,
      }}
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

      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
    </div>
  );
}
