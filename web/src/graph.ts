// Explicit named teams — NOT connected components.
//
// The old model ran union-find over every drawn edge: A–B and B–C collapsed
// into ONE team {A,B,C}, and any oracle shared between two links merged the two
// teams. That structurally forbids multi-membership.
//
// New model: teams are first-class { id, name, color } objects. Each drawn edge
// is TAGGED with a teamId. A team's members are the unique node ids touched by
// that team's edges — derived every render (single source of truth; deleting an
// edge can never leave a stale member). A node touched by a Team-A edge AND a
// Team-B edge is simply in BOTH member sets — nothing pulls A and B together.

import type { Edge } from "@xyflow/react";

export type Team = { id: string; name: string; color: string };
export type TeamEdgeData = { teamId: string };

// ~8 distinct, on-theme hues. New Team walks the ring by team count.
export const TEAM_PALETTE = [
  "#64b5f6", // Neo blue
  "#34e5b0", // emerald
  "#f59e0b", // amber
  "#c084fc", // violet
  "#f472b6", // pink
  "#22d3ee", // cyan
  "#a3e635", // lime
  "#fb7185", // rose
];

export function newTeam(n: number): Team {
  return {
    id: crypto.randomUUID(),
    name: `Team ${n + 1}`,
    color: TEAM_PALETTE[n % TEAM_PALETTE.length],
  };
}

function edgeTeamId(e: Edge): string | undefined {
  const d = e.data as Partial<TeamEdgeData> | undefined;
  return typeof d?.teamId === "string" ? d.teamId : undefined;
}

// teamId → set of member node ids (both endpoints of every tagged edge).
export function membersByTeam(edges: Edge[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const e of edges) {
    const t = edgeTeamId(e);
    if (!t) continue;
    const s = m.get(t) ?? new Set<string>();
    s.add(e.source);
    s.add(e.target);
    m.set(t, s);
  }
  return m;
}

// Inverse: node id → set of teamIds it belongs to (for multi-ring rendering).
export function teamsForNode(edges: Edge[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const e of edges) {
    const t = edgeTeamId(e);
    if (!t) continue;
    for (const n of [e.source, e.target]) {
      const s = m.get(n) ?? new Set<string>();
      s.add(t);
      m.set(n, s);
    }
  }
  return m;
}
