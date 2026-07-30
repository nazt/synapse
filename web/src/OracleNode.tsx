import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { OracleNodeType } from "./types";

// Status → orb color. Green = active, amber = idle, red = stale/unknown.
function statusColor(status: string): string {
  if (status === "active") return "#22c55e";
  if (status === "idle") return "#eab308";
  return "#ef4444";
}

const HANDLE_STYLE = {
  width: 10,
  height: 10,
  background: "#64b5f6",
  border: "2px solid #0a0a0f",
} as const;

export default function OracleNode({ data }: NodeProps<OracleNodeType>) {
  const color = statusColor(data.status);
  return (
    <div
      className="rounded-xl border px-4 py-3 text-neutral-100 shadow-lg transition-shadow"
      style={{
        minWidth: 168,
        background: "#12121a",
        borderColor: data.highlighted ? "#64b5f6" : "#2a2a35",
        boxShadow: data.highlighted
          ? "0 0 0 1px #64b5f6, 0 0 22px rgba(100,181,246,0.55)"
          : "0 1px 3px rgba(0,0,0,0.4)",
      }}
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
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
    </div>
  );
}
