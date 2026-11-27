import type { GraphEdge, GraphNode, MemoryGraphPayload, MemoryItem } from './types.js';

/**
 * Deterministic radial knowledge graph layout linking Memories -> Anchored Files & Tags.
 * Pure TypeScript, zero D3/canvas bloat, renders crisp interactive SVG inside MCP App.
 */
export function buildMemoryGraph(memories: MemoryItem[]): MemoryGraphPayload {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeMap = new Map<string, GraphNode>();

  const cx = 340;
  const cy = 200;

  const memList = memories.slice(0, 14);
  const fileSet = new Map<string, { label: string; count: number }>();
  const tagSet = new Map<string, { label: string; count: number }>();

  for (const m of memList) {
    for (const a of m.anchors) {
      const cur = fileSet.get(a.filePath) ?? { label: a.basename, count: 0 };
      cur.count += 1;
      fileSet.set(a.filePath, cur);
    }
    for (const t of m.tags.slice(0, 3)) {
      const cur = tagSet.get(t) ?? { label: `#${t}`, count: 0 };
      cur.count += 1;
      tagSet.set(t, cur);
    }
  }

  // Inner ring: Memories
  const memR = memList.length <= 1 ? 0 : 88;
  memList.forEach((m, i) => {
    const angle = (i / Math.max(1, memList.length)) * Math.PI * 2 - Math.PI / 2;
    const node: GraphNode = {
      id: m.id,
      kind: 'memory',
      subKind: m.kind,
      label: m.title.length > 26 ? `${m.title.slice(0, 25)}…` : m.title,
      x: Math.round(cx + Math.cos(angle) * memR),
      y: Math.round(cy + Math.sin(angle) * memR * 0.85),
      weight: m.pinned ? 3 : 2,
      drifted: m.drifted,
      pinned: m.pinned,
    };
    nodes.push(node);
    nodeMap.set(node.id, node);
  });

  // Outer left/top arc: Files; outer right/bottom arc: Tags
  const fileEntries = Array.from(fileSet.entries()).slice(0, 10);
  const tagEntries = Array.from(tagSet.entries()).slice(0, 10);
  const outerItems: Array<{ id: string; kind: 'file' | 'tag'; label: string; weight: number }> = [
    ...fileEntries.map(([fp, info]) => ({ id: `file:${fp}`, kind: 'file' as const, label: info.label, weight: info.count })),
    ...tagEntries.map(([t, info]) => ({ id: `tag:${t}`, kind: 'tag' as const, label: info.label, weight: info.count })),
  ];

  const outerRx = 250;
  const outerRy = 158;
  outerItems.forEach((item, i) => {
    const angle = (i / Math.max(1, outerItems.length)) * Math.PI * 2 - Math.PI / 2;
    const node: GraphNode = {
      id: item.id,
      kind: item.kind,
      label: item.label,
      x: Math.round(cx + Math.cos(angle) * outerRx),
      y: Math.round(cy + Math.sin(angle) * outerRy),
      weight: item.weight,
    };
    nodes.push(node);
    nodeMap.set(node.id, node);
  });

  // Edges
  for (const m of memList) {
    for (const a of m.anchors) {
      const targetId = `file:${a.filePath}`;
      if (nodeMap.has(targetId)) {
        edges.push({ source: m.id, target: targetId, kind: 'anchors' });
      }
    }
    for (const t of m.tags.slice(0, 3)) {
      const targetId = `tag:${t}`;
      if (nodeMap.has(targetId)) {
        edges.push({ source: m.id, target: targetId, kind: 'tagged' });
      }
    }
  }

  return { nodes, edges };
}
