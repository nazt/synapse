import type { Node } from "@xyflow/react";

// One oracle as returned by GET /api/synapse/census (server-flattened census).
export type OracleData = {
  name: string;
  status: string;
  host: string;
  session: string;
  idleSec: number;
  // UI-only: set true when this node is in the hovered/target component.
  highlighted: boolean;
  // UI-only: set true when this node is the armed source of a pending
  // click-to-connect (tap A, then tap B → edge A→B).
  armed: boolean;
};

export type CensusResponse = {
  ok: boolean;
  mock: boolean;
  oracles: Omit<OracleData, "highlighted" | "armed">[];
};

// A custom ReactFlow node carrying OracleData under the "oracle" type key.
export type OracleNodeType = Node<OracleData, "oracle">;

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
