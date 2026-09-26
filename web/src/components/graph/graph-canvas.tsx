import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-2d";

import type { GraphData, GraphEdge, GraphNode, Status } from "@/lib/types";

/* Canvas drawing needs literal colours; these come straight from the spec. */
const STATUS_COLOR: Record<Status, string> = {
  todo: "#94a3b8",
  in_progress: "#3b82f6",
  review: "#f59e0b",
  done: "#22c55e",
};
const ROLE_COLOR = { pm: "#a78bfa", senior: "#60a5fa", junior: "#94a3b8" } as const;
const PROJECT = "#8b5cf6";
const MILESTONE = "#6366f1";
const BG = "#0b0d14";

type N = NodeObject & GraphNode;
type L = LinkObject & { type: GraphEdge["type"]; s: string; t: string };

export type GraphFilters = {
  department: string;
  status: string;
  edges: Record<GraphEdge["type"], boolean>;
};

function idOf(v: unknown): string {
  return typeof v === "object" && v !== null ? String((v as { id: string }).id) : String(v);
}

export default function GraphCanvas({
  data,
  filters,
  fitSignal,
  selectedId,
  onSelect,
}: {
  data: GraphData;
  filters: GraphFilters;
  fitSignal: number;
  selectedId: string | null;
  onSelect: (node: GraphNode | null) => void;
}) {
  const fg = useRef<ForceGraphMethods<N, L> | undefined>(undefined);
  const wrap = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<string, N>());
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hover, setHover] = useState<string | null>(null);
  const didInitialFit = useRef(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* Merge into existing node objects so positions survive every poll. */
  const graph = useMemo(() => {
    const visible = data.nodes.filter((n) => {
      if (n.type !== "task") return true;
      if (filters.department && n.department !== filters.department) return false;
      if (filters.status && n.status !== filters.status) return false;
      return true;
    });
    const ids = new Set(visible.map((n) => n.id));
    const nodes = visible.map((n) => {
      const prev = cache.current.get(n.id);
      if (prev) {
        Object.assign(prev, n);
        return prev;
      }
      const fresh = { ...n } as N;
      cache.current.set(n.id, fresh);
      return fresh;
    });
    const links: L[] = data.edges
      .filter((e) => filters.edges[e.type] && ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, type: e.type, s: e.source, t: e.target }));
    return { nodes, links };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(data), JSON.stringify(filters)]);

  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of graph.links) {
      if (!m.has(l.s)) m.set(l.s, new Set());
      if (!m.has(l.t)) m.set(l.t, new Set());
      m.get(l.s)?.add(l.t);
      m.get(l.t)?.add(l.s);
    }
    return m;
  }, [graph]);

  const highlighted = useMemo(() => {
    if (!selectedId) return null;
    const set = new Set<string>([selectedId, ...(neighbours.get(selectedId) ?? [])]);
    return set;
  }, [selectedId, neighbours]);

  useEffect(() => {
    if (fitSignal) fg.current?.zoomToFit(400, 40);
  }, [fitSignal]);

  const subtree = (rootId: string) => {
    const out = new Set<string>([rootId]);
    const queue = [rootId];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const l of graph.links) {
        if ((l.type === "contains" || l.type === "subtask") && l.s === cur && !out.has(l.t)) {
          out.add(l.t);
          queue.push(l.t);
        }
      }
    }
    return out;
  };

  const dim = (id: string) => highlighted !== null && !highlighted.has(id);

  return (
    <div
      ref={wrap}
      className="absolute inset-0"
      style={{
        backgroundColor: BG,
        backgroundImage: "radial-gradient(circle at 1px 1px, rgba(148,163,184,.12) 1px, transparent 0)",
        backgroundSize: "24px 24px",
      }}
    >
      <ForceGraph2D<N, L>
        ref={fg}
        width={size.w}
        height={size.h}
        graphData={graph as never}
        backgroundColor={BG}
        autoPauseRedraw={false}
        cooldownTicks={180}
        d3AlphaDecay={0.025}
        d3VelocityDecay={0.28}
        nodeRelSize={5}
        nodeVal={(n) => (n.type === "project" ? 10 : n.type === "milestone" ? 5 : 2.2)}
        onNodeHover={(n) => setHover(n ? String(n.id) : null)}
        onNodeClick={(n) => {
          onSelect(selectedId === String(n.id) ? null : n);
        }}
        onBackgroundClick={() => {
          onSelect(null);
        }}
        onEngineStop={() => {
          if (didInitialFit.current) return;
          didInitialFit.current = true;
          fg.current?.zoomToFit(600, 90);
        }}
        linkColor={(l) => {
          const connected = selectedId && (l.s === selectedId || l.t === selectedId);
          const a = dim(l.s) || dim(l.t) ? 0.035 : 1;
          if (l.type === "depends_on") return `rgba(249,115,22,${0.9 * a})`;
          if (l.type === "mentions") return `rgba(34,211,238,${0.7 * a})`;
          if (l.type === "works_on") {
            const person = cache.current.get(l.s)?.type === "person" ? cache.current.get(l.s) : cache.current.get(l.t);
            const c = person?.role ? ROLE_COLOR[person.role] : "#94a3b8";
            return a < 1 ? "rgba(148,163,184,0.06)" : `${c}99`;
          }
          if (connected) return `rgba(129,140,248,${0.95 * a})`;
          return `rgba(148,163,184,${0.28 * a})`;
        }}
        linkWidth={(l) => selectedId && (l.s === selectedId || l.t === selectedId) ? 2.4 : l.type === "depends_on" ? 1.4 : 0.7}
        linkLineDash={(l) => (l.type === "mentions" ? [3, 3] : null)}
        linkDirectionalArrowLength={(l) => (l.type === "depends_on" ? 4 : 0)}
        linkDirectionalArrowRelPos={0.9}
        linkDirectionalParticles={(l) => (l.type === "depends_on" ? 2 : 0)}
        linkDirectionalParticleWidth={2}
        linkDirectionalParticleColor={() => "#fb923c"}
        nodeCanvasObject={(n, ctx, scale) => {
          const x = n.x ?? 0;
          const y = n.y ?? 0;
          const faded = dim(String(n.id));
          const selected = selectedId === String(n.id);
          const connected = highlighted?.has(String(n.id)) ?? false;
          ctx.globalAlpha = faded ? 0.08 : 1;
          const r = n.type === "project" ? 15 : n.type === "milestone" ? 9 : 6;

          if (selected || (selectedId && connected)) {
            ctx.beginPath();
            ctx.arc(x, y, r + (selected ? 8 : 4), 0, Math.PI * 2);
            ctx.fillStyle = selected ? "rgba(99,102,241,0.24)" : "rgba(16,185,129,0.12)";
            ctx.fill();
            ctx.strokeStyle = selected ? "#818cf8" : "rgba(52,211,153,0.75)";
            ctx.lineWidth = selected ? 2 : 1;
            ctx.stroke();
          }

          if (n.live) {
            const pulse = 3 + Math.sin(Date.now() / 250) * 2;
            ctx.beginPath();
            ctx.arc(x, y, r + pulse + 2, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(16,185,129,0.25)";
            ctx.fill();
            ctx.strokeStyle = "#10b981";
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }

          if (n.type === "person") {
            const s = 12;
            ctx.beginPath();
            ctx.roundRect(x - s / 2, y - s / 2, s, s, 3);
            ctx.fillStyle = n.role ? ROLE_COLOR[n.role] : "#94a3b8";
            ctx.fill();
          } else {
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle =
              n.type === "project" ? PROJECT : n.type === "milestone" ? MILESTONE : n.status ? STATUS_COLOR[n.status] : "#94a3b8";
            ctx.fill();
            if (n.overdue) {
              ctx.strokeStyle = "#ef4444";
              ctx.lineWidth = 1.5;
              ctx.stroke();
            }
          }

          if (hover === n.id || selected || (selectedId && connected) || scale > 1.8 || n.type === "project") {
            const fs = (selected ? 12 : 10) / scale;
            ctx.font = `${selected ? 600 : 500} ${fs}px "DM Sans", sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = faded ? "#64748b" : "#f8fafc";
            ctx.fillText(n.label, x, y + r + 2);
          }
          ctx.globalAlpha = 1;
        }}
        nodePointerAreaPaint={(n, color, ctx) => {
          const r = n.type === "project" ? 15 : n.type === "milestone" ? 9 : 7;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, Math.PI * 2);
          ctx.fill();
        }}
      />
    </div>
  );
}
