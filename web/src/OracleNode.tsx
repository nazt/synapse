import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { OracleNodeType } from "./types";

// Status → color + label. Active pops (green), idle is amber, and everything
// else (stale/offline/unknown) reads as calm slate — not alarming red, since
// "offline" is a state, not an error. Red is reserved for real failures.
function statusMeta(status: string): { color: string; label: string; live: boolean } {
  if (status === "active") return { color: "#34d399", label: "active", live: true };
  if (status === "idle") return { color: "#fbbf24", label: "idle", live: true };
  return { color: "#8595a8", label: status || "offline", live: false };
}

// Compact idle duration: 0s / 45s / 12m / 3h / 2d.
function fmtIdle(sec: number): string {
  if (sec < 0) return "";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

const HANDLE_STYLE = {
  width: 9,
  height: 9,
  background: "#64b5f6",
  border: "2px solid #0a0a0f",
  opacity: 0.55,
} as const;

export default function OracleNode({ data }: NodeProps<OracleNodeType>) {
  const { color, label, live } = statusMeta(data.status);
  const armed = data.armed;
  const highlighted = data.highlighted;
  const idle = fmtIdle(data.idleSec);

  const borderColor = armed ? "#f59e0b" : highlighted ? "#64b5f6" : "#23232e";
  const ring = armed
    ? "0 0 0 1.5px #f59e0b, 0 0 26px rgba(245,158,11,0.45)"
    : highlighted
      ? "0 0 0 1.5px #64b5f6, 0 0 26px rgba(100,181,246,0.45)"
      : "0 1px 2px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.02)";

  return (
    <div
      className="group cursor-pointer select-none rounded-2xl border px-3.5 py-2.5 text-neutral-100 transition-[transform,box-shadow,border-color,opacity] duration-200 ease-out hover:-translate-y-0.5"
      style={{
        minWidth: 176,
        background:
          "linear-gradient(180deg, rgba(30,30,42,0.92) 0%, rgba(18,18,26,0.96) 100%)",
        borderColor,
        boxShadow: ring,
        opacity: live || armed || highlighted ? 1 : 0.72,
      }}
      title="click to connect — tap another oracle to link them"
    >
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />

      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center">
          {live && (
            <span
              className="absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping"
              style={{ background: color }}
            />
          )}
          <span
            className="relative inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: color, boxShadow: `0 0 7px ${color}` }}
            aria-label={label}
          />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight">
          {data.name}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
        <span className="font-medium" style={{ color }}>
          {label}
        </span>
        {idle && <span className="text-neutral-600">· {idle}</span>}
        {data.host && (
          <span className="ml-auto min-w-0 truncate text-neutral-500">
            {data.host.replace(/^fleet:\s*/, "")}
          </span>
        )}
      </div>

      {armed && (
        <div
          className="mt-1.5 text-[10.5px] font-medium"
          style={{ color: "#f59e0b" }}
        >
          click another oracle to link →
        </div>
      )}

      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
    </div>
  );
}
