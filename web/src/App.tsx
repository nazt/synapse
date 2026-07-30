import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Connection,
  type NodeMouseHandler,
  type NodeTypes,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import OracleNode from "./OracleNode";
import SpaceField, { type VP } from "./SpaceField";
import CommandPalette, { type PaletteItem } from "./CommandPalette";
import TerminalInspector from "./TerminalInspector";
import {
  membersByTeam,
  teamsForNode,
  newTeam,
  type Team,
} from "./graph";
import type {
  CensusResponse,
  OracleCensus,
  OracleNodeType,
  TeamEdge,
  TeamResponse,
} from "./types";

const STATUS_DOT: Record<string, string> = {
  active: "#34d399",
  idle: "#fbbf24",
};
function dotFor(status: string): string {
  return STATUS_DOT[status] ?? "#8595a8";
}

const nodeTypes: NodeTypes = { oracle: OracleNode };

// ── Organic layout ──────────────────────────────────────────────────────
// Golden-angle phyllotaxis scatter: deterministic (stable across census
// refreshes), even areal density, and NO rows/columns — the rigid grid is
// gone. Continuous drift is a pure CSS transform inside OracleNode, so node
// positions here stay fixed and never fight drag / click-to-connect.
const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // 2.39996… rad
function layout(i: number): { x: number; y: number } {
  const r = 172 * Math.sqrt(i + 0.5);
  const a = i * GOLDEN;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

// Show useful oracles first: active → idle → everything else. Stable tiebreak
// by name so the scatter doesn't reshuffle between census refreshes.
const STATUS_RANK: Record<string, number> = { active: 0, idle: 1 };
function byStatus(
  a: { status: string; name: string },
  b: { status: string; name: string },
): number {
  const d = (STATUS_RANK[a.status] ?? 2) - (STATUS_RANK[b.status] ?? 2);
  return d !== 0 ? d : a.name.localeCompare(b.name);
}

// Build a deduped, team-tagged edge id — includes teamId so the SAME A–B pair
// can live in two teams, and dedupes within one team (either direction).
function edgeId(teamId: string, a: string, b: string): string {
  return `${teamId}:${a}-${b}`;
}

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<OracleNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<TeamEdge>([]);

  // One default team so the board works immediately — activeTeamId is a string.
  const initialTeam = useMemo(() => newTeam(0), []);
  const [teams, setTeams] = useState<Team[]>([initialTeam]);
  const [activeTeamId, setActiveTeamId] = useState<string>(initialTeam.id);
  const [hoverTeamId, setHoverTeamId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [armedId, setArmedId] = useState<string | null>(null);
  // The oracle whose live terminal is open in the inspector dock (right-click a
  // node, ⌘K → Inspect, or click a team member chip).
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [busyTeam, setBusyTeam] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, TeamResponse>>({});
  const [recentEdge, setRecentEdge] = useState<string | null>(null);
  const [mock, setMock] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Live viewport for the parallax starfield — written on every pan/zoom via a
  // ref (NOT React state, which would thrash the tree every frame).
  const viewportRef = useRef<VP>({ x: 0, y: 0, zoom: 1 });
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load census → nodes (organic scatter).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/synapse/census")
      .then((r) => r.json() as Promise<CensusResponse>)
      .then((res) => {
        if (cancelled) return;
        setMock(res.mock);
        const sorted = [...res.oracles].sort(byStatus);
        setNodes(
          sorted.map((o, i) => ({
            id: o.name,
            type: "oracle" as const,
            position: layout(i),
            data: {
              ...o,
              armed: false,
              stage: "neutral" as const,
              teamColors: [],
            },
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

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  // Deep-link: ?inspect=<oracle> auto-opens that oracle's terminal on load — a
  // shareable link straight to a fleet member's live pane.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("inspect");
    if (q) setInspectId(q);
  }, []);

  const active = useMemo(
    () => teams.find((t) => t.id === activeTeamId) ?? null,
    [teams, activeTeamId],
  );

  // The census row backing the terminal inspector (node.data carries all the
  // census fields). Falls to null when the node is gone or nothing is focused.
  const inspectOracle = useMemo<OracleCensus | null>(() => {
    if (!inspectId) return null;
    const n = nodes.find((x) => x.id === inspectId);
    if (!n) return null;
    const { name, status, host, session, pane, idleSec } = n.data;
    return { name, status, host, session, pane, idleSec };
  }, [inspectId, nodes]);

  // ── Team actions ───────────────────────────────────────────────────────
  const addTeam = useCallback(() => {
    setTeams((ts) => {
      const t = newTeam(ts.length);
      setActiveTeamId(t.id);
      setEditingId(t.id);
      return [...ts, t];
    });
  }, []);

  const renameTeam = useCallback((id: string, name: string) => {
    setTeams((ts) => ts.map((t) => (t.id === id ? { ...t, name } : t)));
  }, []);

  const deleteTeam = useCallback(
    (id: string) => {
      // Ephemeral compose state — dropping a team's tagged edges is fine.
      setEdges((es) => es.filter((e) => e.data?.teamId !== id));
      setResults((r) => {
        const { [id]: _drop, ...rest } = r;
        return rest;
      });
      setTeams((ts) => {
        const next = ts.filter((t) => t.id !== id);
        // Keep at least one team so the pen always has ink.
        if (next.length === 0) {
          const fresh = newTeam(0);
          setActiveTeamId(fresh.id);
          return [fresh];
        }
        setActiveTeamId((cur) => (cur === id ? next[0].id : cur));
        return next;
      });
    },
    [setEdges],
  );

  // Flash the freshest link for a connect pulse, then settle.
  const flash = useCallback((id: string) => {
    setRecentEdge(id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setRecentEdge(null), 720);
  }, []);

  // Add a team-tagged edge (deduped within the team, either direction).
  const link = useCallback(
    (a: string, b: string, teamId: string) => {
      if (!a || !b || a === b) return;
      const id = edgeId(teamId, a, b);
      const rev = edgeId(teamId, b, a);
      setEdges((es) =>
        es.some((e) => e.id === id || e.id === rev)
          ? es
          : [...es, { id, source: a, target: b, data: { teamId } }],
      );
      flash(id);
    },
    [setEdges, flash],
  );

  // Arm-or-link into the ACTIVE team: first pick arms A (amber), second links
  // A→B and adds both to the active team; picking A again cancels.
  const armOrLink = useCallback(
    (id: string) => {
      setArmedId((cur) => {
        if (cur === null) return id;
        if (cur === id) return null;
        link(cur, id, activeTeamId);
        return null;
      });
    },
    [link, activeTeamId],
  );

  // Drag-to-connect also tags the active team.
  const onConnect = useCallback(
    (c: Connection) => link(c.source, c.target, activeTeamId),
    [link, activeTeamId],
  );

  const onNodeClick: NodeMouseHandler<OracleNodeType> = useCallback(
    (_e, node) => armOrLink(node.id),
    [armOrLink],
  );
  const onPaneClick = useCallback(() => setArmedId(null), []);

  // Right-click a node → open its live terminal in the inspector. preventDefault
  // suppresses the browser context menu; click-to-connect stays on left-click.
  const onNodeContextMenu: NodeMouseHandler<OracleNodeType> = useCallback(
    (e, node) => {
      e.preventDefault();
      setInspectId(node.id);
    },
    [],
  );

  // Add one oracle to the ACTIVE team. Membership is edge-derived, so link it to
  // an existing member; if the team is empty, arm it as the team's first pick.
  const addToActiveTeam = useCallback(
    (name: string) => {
      const members = [...(membersByTeam(edges).get(activeTeamId) ?? [])];
      const anchor = members.find((m) => m !== name);
      if (anchor) link(name, anchor, activeTeamId);
      else setArmedId(name);
    },
    [edges, activeTeamId, link],
  );

  const onMove = useCallback((_e: unknown, vp: Viewport) => {
    viewportRef.current = vp;
  }, []);

  // ── Derive membership + staging every render (single source of truth) ──
  const membersMap = useMemo(() => membersByTeam(edges), [edges]);
  const nodeTeamsMap = useMemo(() => teamsForNode(edges), [edges]);
  const colorOf = useCallback(
    (id: string | null | undefined) =>
      id ? teams.find((t) => t.id === id)?.color : undefined,
    [teams],
  );

  // The team ON STAGE: hovered team row wins, else the active (pen) team.
  const stagedTeamId = hoverTeamId ?? activeTeamId;
  const stageMembers = useMemo(
    () => membersMap.get(stagedTeamId) ?? new Set<string>(),
    [membersMap, stagedTeamId],
  );
  const anyStaged = stageMembers.size > 0;
  const stagedColor = colorOf(stagedTeamId);

  const activeMembers = useMemo(
    () => [...(membersMap.get(activeTeamId) ?? [])],
    [membersMap, activeTeamId],
  );

  const displayNodes = useMemo(
    () =>
      nodes.map((n) => {
        const stage: "on" | "off" | "neutral" = !anyStaged
          ? "neutral"
          : stageMembers.has(n.id)
            ? "on"
            : "off";
        const tIds = [...(nodeTeamsMap.get(n.id) ?? [])];
        const teamColors = tIds
          .map((t) => colorOf(t))
          .filter((c): c is string => Boolean(c));
        return {
          ...n,
          zIndex: stage === "on" ? 20 : 1,
          data: {
            ...n.data,
            armed: armedId === n.id,
            stage,
            teamColors,
            teamColor: stage === "on" ? stagedColor : undefined,
          },
        };
      }),
    [nodes, anyStaged, stageMembers, nodeTeamsMap, colorOf, armedId, stagedColor],
  );

  // One styled edge per tagged edge, colored by its team. The staged team's
  // edges are bright + flow-animated; the rest recede but stay visible.
  const displayEdges = useMemo(
    () =>
      edges.map((e) => {
        const tid = e.data?.teamId;
        const c = colorOf(tid) ?? "#64b5f6";
        const onStage = anyStaged && tid === stagedTeamId;
        const cls = [
          onStage ? "is-team" : "",
          e.id === recentEdge ? "just-linked" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return {
          ...e,
          className: cls || undefined,
          animated: false,
          style: {
            stroke: c,
            strokeWidth: onStage ? 2.4 : 1.5,
            opacity: onStage ? 1 : 0.28,
            ...(onStage
              ? { filter: `drop-shadow(0 0 6px ${c}bb)` }
              : {}),
          },
        };
      }),
    [edges, colorOf, anyStaged, stagedTeamId, recentEdge],
  );

  const liveCount = useMemo(
    () =>
      nodes.filter(
        (n) => n.data.status === "active" || n.data.status === "idle",
      ).length,
    [nodes],
  );

  // ── Fan-out ────────────────────────────────────────────────────────────
  const submitTeam = useCallback(
    async (team: Team, members: string[], dry: boolean) => {
      if (members.length < 2 || busyTeam) return;
      setBusyTeam(team.id);
      setResults((r) => {
        const { [team.id]: _drop, ...rest } = r;
        return rest;
      });
      try {
        const res = await fetch("/api/synapse/team", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            members,
            teamName: team.name,
            dryRun: dry,
          }),
        });
        const json = (await res.json()) as TeamResponse;
        setResults((r) => ({ ...r, [team.id]: json }));
      } catch (e: unknown) {
        setResults((r) => ({
          ...r,
          [team.id]: {
            ok: false,
            sent: [],
            dryRun: dry,
            error: e instanceof Error ? e.message : String(e),
          },
        }));
      } finally {
        setBusyTeam(null);
      }
    },
    [busyTeam],
  );

  // Form the ACTIVE team (⌘↵ + panel).
  const submitActive = useCallback(() => {
    if (active) void submitTeam(active, activeMembers, dryRun);
  }, [active, activeMembers, dryRun, submitTeam]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.key === "Escape") setArmedId(null);
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submitActive();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submitActive]);

  // ── ⌘K palette ─────────────────────────────────────────────────────────
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const actions: PaletteItem[] = [
      {
        id: "action:newteam",
        label: "New Team",
        section: "Actions",
        hint: "+",
        run: () => {
          addTeam();
          return true; // keep palette open to immediately pick oracles
        },
      },
      {
        id: "action:form",
        label: active
          ? `${dryRun ? "Preview" : "Form"} «${active.name}»`
          : "Form team",
        section: "Actions",
        hint: activeMembers.length >= 2 ? `⌘↵ · ${activeMembers.length}` : "need 2+",
        disabled: activeMembers.length < 2,
        run: () => {
          submitActive();
        },
      },
      {
        id: "action:dryrun",
        label: dryRun ? "Turn dry-run OFF (send for real)" : "Turn dry-run ON",
        section: "Actions",
        hint: dryRun ? "on" : "off",
        run: () => setDryRun((d) => !d),
      },
      {
        id: "action:clearactive",
        label: active ? `Clear links of «${active.name}»` : "Clear active links",
        section: "Actions",
        hint: `${activeMembers.length}`,
        disabled: !active || activeMembers.length === 0,
        run: () =>
          setEdges((es) => es.filter((e) => e.data?.teamId !== activeTeamId)),
      },
    ];
    const teamItems: PaletteItem[] = teams.map((t) => ({
      id: `team:${t.id}`,
      label: `Stage «${t.name}»`,
      section: "Teams",
      hint: t.id === activeTeamId ? "active" : `${membersMap.get(t.id)?.size ?? 0}`,
      dotColor: t.color,
      run: () => {
        setActiveTeamId(t.id);
      },
    }));
    const oracleItems: PaletteItem[] = nodes.map((n) => ({
      id: `oracle:${n.id}`,
      label: n.id,
      section: "Oracles",
      hint: armedId === n.id ? "armed" : n.data.status,
      dotColor: dotFor(n.data.status),
      run: () => {
        const willArm = armedId === null;
        armOrLink(n.id);
        return willArm; // keep palette open after arming, so you can pick B
      },
    }));
    const inspectItems: PaletteItem[] = nodes.map((n) => ({
      id: `inspect:${n.id}`,
      label: `⎙ ${n.id} terminal`,
      section: "Inspect",
      hint: "peek",
      dotColor: dotFor(n.data.status),
      run: () => setInspectId(n.id),
    }));
    return [...actions, ...teamItems, ...oracleItems, ...inspectItems];
  }, [
    nodes,
    teams,
    active,
    activeTeamId,
    activeMembers.length,
    membersMap,
    armedId,
    dryRun,
    addTeam,
    submitActive,
    armOrLink,
    setEdges,
  ]);

  return (
    <div className="hud-space relative h-screen w-screen overflow-hidden">
      {/* Header */}
      <header className="pointer-events-none absolute left-0 top-0 z-10 flex items-center gap-3 px-5 py-4">
        <div className="flex items-baseline gap-2.5">
          <h1
            className="text-[17px] font-bold tracking-[0.18em]"
            style={{
              color: "#8fd0ff",
              textShadow: "0 0 18px rgba(100,181,246,0.55)",
            }}
          >
            SYNAPSE
          </h1>
          <span className="font-mono text-[11px] tabular-nums text-neutral-500">
            <span style={{ color: "#34e5b0" }}>{liveCount}</span>/{nodes.length}{" "}
            live
          </span>
        </div>
        <span className="hidden font-mono text-[11px] uppercase tracking-wide text-neutral-600 sm:inline">
          tap to link · right-click for live terminal · click a team to stage
        </span>
        {mock && (
          <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400">
            mock census
          </span>
        )}
        {loadError && (
          <span className="rounded-md bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-400">
            census error
          </span>
        )}
      </header>

      {/* Living background — painted BEHIND the transparent ReactFlow. */}
      <SpaceField viewportRef={viewportRef} />

      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={onPaneClick}
        onMove={onMove}
        onInit={(i) => {
          viewportRef.current = i.getViewport();
        }}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.28, maxZoom: 1.1 }}
        minZoom={0.4}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
        style={{ background: "transparent" }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          color="#1a2740"
          gap={34}
          size={1}
          style={{ opacity: 0.5 }}
        />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) =>
            (n.data as { status?: string })?.status === "active"
              ? "#34e5b0"
              : (n.data as { status?: string })?.status === "idle"
                ? "#fbbf24"
                : "#3a4761"
          }
          maskColor="rgba(6,7,12,0.78)"
          style={{
            background: "rgba(12,16,24,0.6)",
            border: "1px solid rgba(100,181,246,0.12)",
          }}
        />
      </ReactFlow>

      {/* Armed prompt */}
      {armedId && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2">
          <div
            className="rounded-full border px-4 py-1.5 font-mono text-[11px] uppercase tracking-wide shadow-lg"
            style={{
              background: "rgba(23,20,10,0.75)",
              backdropFilter: "blur(8px)",
              borderColor: "rgba(245,158,11,0.55)",
              color: "#fbbf24",
              boxShadow: "0 0 24px rgba(245,158,11,0.25)",
            }}
          >
            ▸ linking into{" "}
            <b className="font-semibold" style={{ color: active?.color }}>
              {active?.name}
            </b>{" "}
            from <b className="font-semibold">{armedId}</b> · tap another · esc
          </div>
        </div>
      )}

      {/* Teams panel */}
      <div className="absolute bottom-4 right-4 z-10 w-[22rem] max-w-[calc(100vw-2rem)]">
        <div
          className="rounded-xl border p-4 shadow-2xl"
          style={{
            background: "rgba(12,16,24,0.72)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            borderColor: "rgba(100,181,246,0.16)",
            boxShadow:
              "0 12px 40px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-neutral-100">Teams</span>
            <div className="flex items-center gap-3">
              <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-neutral-300">
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[#64b5f6]"
                />
                dry run
              </label>
              <button
                type="button"
                onClick={addTeam}
                className="rounded-md px-2 py-1 text-xs font-semibold transition-colors"
                style={{ background: "rgba(100,181,246,0.16)", color: "#8fd0ff" }}
              >
                + New Team
              </button>
            </div>
          </div>

          <div className="mt-3 max-h-[52vh] space-y-2 overflow-y-auto pr-0.5">
            {teams.length === 0 && (
              <p className="text-xs text-neutral-500">
                No teams yet — + New Team, then tap two oracles.
              </p>
            )}
            {teams.map((t) => {
              const members = [...(membersMap.get(t.id) ?? [])];
              const isActive = t.id === activeTeamId;
              const res = results[t.id];
              return (
                <div
                  key={t.id}
                  onClick={() => setActiveTeamId(t.id)}
                  onMouseEnter={() => setHoverTeamId(t.id)}
                  onMouseLeave={() => setHoverTeamId(null)}
                  className="cursor-pointer rounded-lg border p-2.5 transition-colors"
                  style={{
                    borderColor: isActive
                      ? t.color
                      : "rgba(100,181,246,0.12)",
                    borderLeftWidth: isActive ? 3 : 1,
                    background: isActive
                      ? "rgba(100,181,246,0.06)"
                      : "rgba(255,255,255,0.02)",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: t.color, boxShadow: `0 0 6px ${t.color}` }}
                    />
                    {editingId === t.id ? (
                      <input
                        autoFocus
                        value={t.name}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => renameTeam(t.id, e.target.value)}
                        onBlur={() => setEditingId(null)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === "Escape")
                            setEditingId(null);
                        }}
                        className="min-w-0 flex-1 rounded bg-black/30 px-1.5 py-0.5 text-[13px] font-semibold text-neutral-100 focus:outline-none"
                        style={{ boxShadow: `inset 0 0 0 1px ${t.color}66` }}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveTeamId(t.id);
                          setEditingId(t.id);
                        }}
                        className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold text-neutral-100"
                        title="click to rename"
                      >
                        {t.name}
                      </button>
                    )}
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-neutral-500">
                      {members.length}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteTeam(t.id);
                      }}
                      className="shrink-0 rounded px-1 text-sm leading-none text-neutral-600 transition-colors hover:text-red-400"
                      title="delete team"
                    >
                      ✕
                    </button>
                  </div>

                  {members.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {members.map((m) => (
                        <button
                          type="button"
                          key={m}
                          onClick={(e) => {
                            e.stopPropagation();
                            setInspectId(m);
                          }}
                          className="rounded-full px-1.5 py-0.5 text-[11px] transition-transform hover:scale-105"
                          style={{
                            background: `${t.color}1f`,
                            color: t.color,
                          }}
                          title={`inspect ${m}`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1.5 text-[11px] text-neutral-600">
                      tap two oracles to add members
                    </p>
                  )}

                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void submitTeam(t, members, dryRun);
                      }}
                      disabled={members.length < 2 || busyTeam === t.id}
                      className="rounded-md px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                      style={{ background: t.color, color: "#0a0a0f" }}
                    >
                      {busyTeam === t.id
                        ? "Sending…"
                        : dryRun
                          ? "Preview"
                          : "Form"}
                    </button>
                    {res && (
                      <span
                        className="font-mono text-[11px]"
                        style={{ color: res.ok ? "#34e5b0" : "#ef4444" }}
                      >
                        {res.dryRun ? "preview" : "sent"} · {res.sent.length}
                      </span>
                    )}
                  </div>

                  {res?.error && (
                    <p className="mt-1 text-[11px] text-red-400">{res.error}</p>
                  )}
                  {res?.sent[0] && (
                    <p className="mt-1.5 border-t border-white/5 pt-1.5 text-[11px] leading-relaxed text-neutral-400">
                      {res.sent[0].message}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <p className="mt-2 text-center text-[11px] text-neutral-600">
            active team = ⌘/Ctrl + Enter · one oracle can join many teams
          </p>
        </div>
      </div>

      {/* ⌘K affordance */}
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="absolute bottom-4 left-4 z-10 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wide text-neutral-400 transition-colors hover:text-neutral-100"
        style={{
          background: "rgba(12,16,24,0.72)",
          backdropFilter: "blur(10px)",
          borderColor: "rgba(100,181,246,0.16)",
        }}
      >
        <kbd
          className="rounded px-1.5 py-0.5 text-[10px] text-neutral-200"
          style={{ background: "rgba(100,181,246,0.14)" }}
        >
          ⌘K
        </kbd>
        search &amp; link
      </button>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={paletteItems}
      />

      {/* Terminal inspector — live read-only pane + Wake + add-to-team */}
      <TerminalInspector
        oracle={inspectOracle}
        dryRun={dryRun}
        activeTeamName={active?.name}
        onAddToTeam={addToActiveTeam}
        onClose={() => setInspectId(null)}
      />
    </div>
  );
}
