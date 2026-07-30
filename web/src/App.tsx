import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type NodeMouseHandler,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import OracleNode from "./OracleNode";
import { buildUnionFind } from "./graph";
import type { CensusResponse, OracleNodeType, TeamResponse } from "./types";

const nodeTypes: NodeTypes = { oracle: OracleNode };

const defaultEdgeOptions = {
  animated: true,
  style: { stroke: "#64b5f6", strokeWidth: 2 },
} as const;

// Lay oracles out on a circle so every node has clear handle room.
function layout(count: number, i: number): { x: number; y: number } {
  if (count <= 1) return { x: 0, y: 0 };
  const radius = Math.max(220, count * 46);
  const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
  return {
    x: Math.round(Math.cos(angle) * radius),
    y: Math.round(Math.sin(angle) * radius),
  };
}

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<OracleNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TeamResponse | null>(null);
  const [mock, setMock] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load census → nodes.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/synapse/census")
      .then((r) => r.json() as Promise<CensusResponse>)
      .then((res) => {
        if (cancelled) return;
        setMock(res.mock);
        setNodes(
          res.oracles.map((o, i) => ({
            id: o.name,
            type: "oracle" as const,
            position: layout(res.oracles.length, i),
            data: { ...o, highlighted: false },
          })),
        );
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [setNodes]);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  const onNodeMouseEnter: NodeMouseHandler<OracleNodeType> = useCallback(
    (_event, node) => setHoveredId(node.id),
    [],
  );
  const onNodeMouseLeave: NodeMouseHandler<OracleNodeType> = useCallback(
    () => setHoveredId(null),
    [],
  );

  // Union-find over drawn edges → components.
  const nodeIds = useMemo(() => nodes.map((n) => n.id), [nodes]);
  const uf = useMemo(
    () =>
      buildUnionFind(
        nodeIds,
        edges.map((e) => ({ source: e.source, target: e.target })),
      ),
    [nodeIds, edges],
  );
  const groups = useMemo(() => uf.groups(), [uf]);
  const hoverComponent = useMemo(
    () => (hoveredId ? uf.componentOf(hoveredId) : []),
    [uf, hoveredId],
  );

  // The team the user is about to form: the hovered component, else the
  // largest drawn component.
  const target = useMemo(
    () => (hoverComponent.length >= 2 ? hoverComponent : (groups[0] ?? [])),
    [hoverComponent, groups],
  );

  // Glow whichever component is currently the target.
  const highlightSet = useMemo(() => new Set(target), [target]);
  const displayNodes = useMemo(
    () =>
      nodes.map((n) => {
        const hi = highlightSet.has(n.id);
        return n.data.highlighted === hi
          ? n
          : { ...n, data: { ...n.data, highlighted: hi } };
      }),
    [nodes, highlightSet],
  );

  const canSubmit = edges.length >= 1 && target.length >= 2 && !busy;

  const submit = useCallback(async () => {
    if (target.length < 2 || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/synapse/team", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ members: target, dryRun }),
      });
      setResult((await res.json()) as TeamResponse);
    } catch (e: unknown) {
      setResult({
        ok: false,
        sent: [],
        dryRun,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [target, dryRun, busy]);

  // Cmd/Ctrl+Enter to form the team.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit]);

  return (
    <div className="relative h-screen w-screen" style={{ background: "#0a0a0f" }}>
      {/* Header */}
      <header className="pointer-events-none absolute left-0 top-0 z-10 flex items-center gap-3 p-4">
        <h1
          className="text-lg font-semibold tracking-tight"
          style={{ color: "#64b5f6" }}
        >
          Synapse
        </h1>
        <span className="text-xs text-neutral-500">
          drag a node’s edge to another to form a team
        </span>
        {mock && (
          <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-400">
            mock census
          </span>
        )}
        {loadError && (
          <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-400">
            census error
          </span>
        )}
      </header>

      <ReactFlow
        nodes={displayNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background color="#1c1c26" gap={22} />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor="#64b5f6"
          maskColor="rgba(10,10,15,0.7)"
          style={{ background: "#12121a" }}
        />
      </ReactFlow>

      {/* Team-forming panel */}
      <div className="absolute bottom-4 right-4 z-10 w-80 max-w-[calc(100vw-2rem)]">
        <div
          className="rounded-xl border p-4 shadow-2xl"
          style={{ background: "#12121a", borderColor: "#2a2a35" }}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-neutral-100">
              Form Team
            </span>
            <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-neutral-300">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                className="h-3.5 w-3.5 accent-[#64b5f6]"
              />
              dry run
            </label>
          </div>

          <div className="mt-3 min-h-[1.5rem]">
            {target.length >= 2 ? (
              <div className="flex flex-wrap gap-1.5">
                {target.map((m) => (
                  <span
                    key={m}
                    className="rounded-full px-2 py-0.5 text-xs"
                    style={{
                      background: "rgba(100,181,246,0.12)",
                      color: "#64b5f6",
                    }}
                  >
                    {m}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-neutral-500">
                Draw an edge between two oracles, then hover a team.
              </p>
            )}
          </div>

          {groups.length > 1 && (
            <p className="mt-2 text-xs text-neutral-500">
              {groups.length} teams drawn — hover one to target it.
            </p>
          )}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="mt-3 w-full rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: "#64b5f6", color: "#0a0a0f" }}
          >
            {busy
              ? "Sending…"
              : dryRun
                ? `Preview team (${target.length || 0})`
                : `Form team (${target.length || 0})`}
          </button>
          <p className="mt-1.5 text-center text-[11px] text-neutral-600">
            ⌘/Ctrl + Enter
          </p>

          {result && (
            <div
              className="mt-3 rounded-lg border p-3"
              style={{ borderColor: "#2a2a35", background: "#0d0d14" }}
            >
              <div className="flex items-center justify-between text-xs">
                <span
                  className="font-semibold"
                  style={{ color: result.ok ? "#22c55e" : "#ef4444" }}
                >
                  {result.dryRun ? "Dry-run preview" : "Sent"}
                </span>
                <span className="text-neutral-500">
                  {result.sent.length} member{result.sent.length === 1 ? "" : "s"}
                </span>
              </div>
              {result.error && (
                <p className="mt-1 text-xs text-red-400">{result.error}</p>
              )}
              <ul className="mt-2 space-y-1.5">
                {result.sent.map((s) => (
                  <li key={s.member} className="text-xs">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ background: s.ok ? "#22c55e" : "#ef4444" }}
                      />
                      <span className="font-medium text-neutral-200">
                        {s.member}
                      </span>
                    </div>
                    <code className="mt-0.5 block truncate text-[10px] text-neutral-500">
                      {s.command}
                    </code>
                  </li>
                ))}
              </ul>
              {result.sent[0] && (
                <p className="mt-2 border-t pt-2 text-[11px] leading-relaxed text-neutral-400" style={{ borderColor: "#2a2a35" }}>
                  {result.sent[0].message}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
