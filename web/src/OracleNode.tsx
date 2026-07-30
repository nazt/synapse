import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { OracleNodeType } from "./types";

// Status → orb color. Green = active, amber = idle, red = stale/unknown.
function statusColor(status: string): string {
  if (status === "active") return "#22c55e";
  if (status === "idle") return "#eab308";
  return "#ef4444";
}

// Handles stay for power-users who prefer dragging, but they're now secondary:
// the whole node is a click target (click-to-connect). Bigger + softer so a
// stray drag from the node body still catches an edge.
const HANDLE_STYLE = {
  width: 14,
  height: 14,
  background: "#64b5f6",
  border: "2px solid #0a0a0f",
} as const;

export default function OracleNode({ data }: NodeProps<OracleNodeType>) {
  const color = statusColor(data.status);
  const armed = data.armed;
  const borderColor = armed
    ? "#eab308"
    : data.highlighted
      ? "#64b5f6"
      : "#2a2a35";
  const boxShadow = armed
    ? "0 0 0 2px #eab308, 0 0 24px rgba(234,179,8,0.55)"
    : data.highlighted
      ? "0 0 0 1px #64b5f6, 0 0 22px rgba(100,181,246,0.55)"
      : "0 1px 3px rgba(0,0,0,0.4)";
  return (
    <div
      className="cursor-pointer select-none rounded-xl border px-4 py-3 text-neutral-100 shadow-lg transition-all hover:-translate-y-0.5"
      style={{
        minWidth: 184,
        background: armed ? "#171f2b" : "#12121a",
        borderColor,
        boxShadow,
      }}
      title="click to connect — tap another oracle to link them"
    >
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: color, boxShadow: `0 0 8px ${color}` }}
          aria-label={data.status}
        />
        <span className="truncate text-sm font-semibold tracking-tight">
          {data.name}
        </span>
      </div>
      <div className="mt-1 truncate text-xs text-neutral-400">
        {data.host || data.session || "—"}
      </div>
      {armed && (
        <div
          className="mt-1.5 text-[11px] font-medium"
          style={{ color: "#eab308" }}
        >
          click another oracle to link →
        </div>
      )}
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
    </div>
  );
}
