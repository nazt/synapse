import type { Edge, Node } from "@xyflow/react";
import type { TeamEdgeData } from "./graph";

// One oracle as returned by GET /api/synapse/census (server-flattened census).
export type OracleCensus = {
  name: string;
  status: string;
  host: string;
  session: string;
  // Precise tmux pane handle (e.g. "%3855") — best `maw peek` target; may be "".
  pane: string;
  idleSec: number;
};

// Full node data = census fields + UI-only flags driven by App each render.
export type OracleData = OracleCensus & {
  // The armed source of a pending click-to-connect (tap A, then tap B → link).
  armed: boolean;
  // Staging relative to the team currently ON STAGE:
  //   "on"      → this node is a member → rises (scale/glow/z-lift)
  //   "off"     → a team is staged and this node is NOT in it → recedes
  //   "neutral" → nothing staged → resting appearance
  stage: "on" | "off" | "neutral";
  // Colors of every team this node belongs to (one ring/dot each).
  teamColors: string[];
  // Accent of the staged team while this node is on stage (for glow/border).
  teamColor?: string;
};

export type CensusResponse = {
  ok: boolean;
  mock: boolean;
  oracles: OracleCensus[];
};

// A custom ReactFlow node carrying OracleData under the "oracle" type key.
export type OracleNodeType = Node<OracleData, "oracle">;

// A ReactFlow edge tagged with the team it belongs to.
export type TeamEdge = Edge<TeamEdgeData>;

// One planned/executed fan-out delivery, mirrored from the server.
export type SentEntry = {
  member: string;
  command: string;
  message: string;
  ok: boolean;
  error?: string;
};

export type TeamResponse = {
  ok: boolean;
  sent: SentEntry[];
  dryRun: boolean;
  error?: string;
};
