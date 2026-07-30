// Union-find over the drawn edges → connected components (teams).
// A–B, B–C ⇒ {A,B,C}. Disjoint edge sets ⇒ multiple teams on one canvas.

type EdgeLike = { source: string; target: string };

export type UnionFind = {
  /** Root representative for a node id. */
  find: (id: string) => string;
  /** All components with 2+ members, largest first. */
  groups: () => string[][];
  /** The component (member ids) containing `id`; [] if unknown/singleton. */
  componentOf: (id: string) => string[];
};

export function buildUnionFind(nodeIds: string[], edges: EdgeLike[]): UnionFind {
  const parent = new Map<string, string>();
  for (const id of nodeIds) parent.set(id, id);

  const find = (id: string): string => {
    let root = parent.get(id);
    if (root === undefined) return id; // unknown node — treat as its own root
    while (root !== parent.get(root)) {
      const next = parent.get(root);
      if (next === undefined) break;
      root = next;
    }
    // Path compression.
    let cur = id;
    while (cur !== root) {
      const next = parent.get(cur);
      if (next === undefined) break;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };

  const union = (a: string, b: string) => {
    if (!parent.has(a) || !parent.has(b)) return;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const e of edges) union(e.source, e.target);

  const buckets = (): Map<string, string[]> => {
    const map = new Map<string, string[]>();
    for (const id of nodeIds) {
      const root = find(id);
      const arr = map.get(root);
      if (arr) arr.push(id);
      else map.set(root, [id]);
    }
    return map;
  };

  return {
    find,
    groups: () =>
      [...buckets().values()]
        .filter((g) => g.length >= 2)
        .sort((a, b) => b.length - a.length),
    componentOf: (id) => {
      const root = find(id);
      const g = buckets().get(root) ?? [];
      return g.length >= 2 ? g : [];
    },
  };
}
