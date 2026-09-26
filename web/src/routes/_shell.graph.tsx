import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ExternalLink, Maximize, Network, X } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";

import type { GraphFilters } from "@/components/graph/graph-canvas";
import { Button } from "@/components/ui/button";
import { useOpenTask } from "@/hooks/use-task-param";
import { STATUS_LABEL, STATUS_ORDER } from "@/lib/format";
import { graphQuery, meQuery } from "@/lib/queries";
import type { GraphEdge, GraphNode } from "@/lib/types";
import { cn } from "@/lib/utils";

const GraphCanvas = lazy(() => import("@/components/graph/graph-canvas"));

export const Route = createFileRoute("/_shell/graph")({
  head: () => ({
    meta: [
      { title: "Project graph — Orchestra" },
      { name: "description", content: "Relational graph of milestones, tasks and the people working together." },
      { property: "og:title", content: "Project graph — Orchestra" },
      { property: "og:description", content: "Relational graph of milestones, tasks and the people working together." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GraphPage,
});

const EDGE_TYPES: { type: GraphEdge["type"]; label: string }[] = [
  { type: "contains", label: "Contains" },
  { type: "subtask", label: "Subtask" },
  { type: "depends_on", label: "Depends on" },
  { type: "mentions", label: "Mentions" },
  { type: "works_on", label: "Works on" },
];

const LEGEND = [
  { label: "Project", color: "#8b5cf6" },
  { label: "Milestone", color: "#6366f1" },
  { label: "To do", color: "#94a3b8" },
  { label: "In progress", color: "#3b82f6" },
  { label: "Review", color: "#f59e0b" },
  { label: "Done", color: "#22c55e" },
  { label: "PM", color: "#a78bfa", square: true },
  { label: "Senior", color: "#60a5fa", square: true },
  { label: "Junior", color: "#94a3b8", square: true },
];

function GraphPage() {
  const { data: me } = useQuery(meQuery());
  const navigate = useNavigate();
  const openTask = useOpenTask();
  const { data } = useQuery({ ...graphQuery(), enabled: Boolean(me?.capabilities.graph) });
  const [fit, setFit] = useState(0);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [filters, setFilters] = useState<GraphFilters>({
    department: "",
    status: "",
    edges: { contains: true, subtask: true, depends_on: true, mentions: true, works_on: true },
  });

  useEffect(() => {
    if (me && !me.capabilities.graph) void navigate({ to: "/board", replace: true });
  }, [me, navigate]);
  if (!me?.capabilities.graph) return null;

  const departments = [...new Set((data?.nodes ?? []).map((n) => n.department).filter(Boolean) as string[])].sort();
  const connected = selected && data
    ? data.edges.filter((edge) => edge.source === selected.id || edge.target === selected.id).length
    : 0;
  const select =
    "h-8 rounded-md border border-white/15 bg-white/5 px-2 text-xs text-slate-200 [&>option]:bg-slate-900";

  return (
    <div className="dark relative h-full min-h-[500px] overflow-hidden bg-slate-950">
      {data ? (
        <Suspense fallback={null}>
          <GraphCanvas data={data} filters={filters} fitSignal={fit} selectedId={selected?.id ?? null} onSelect={setSelected} />
        </Suspense>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950 text-sm text-slate-400">
          Loading graph…
        </div>
      )}

      <div className="absolute top-5 left-5 flex max-w-[calc(100%-2.5rem)] flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-slate-950/85 p-2 text-slate-200 shadow-xl backdrop-blur-md">
        <div className="flex items-center gap-2 border-r border-white/10 px-2 pr-3">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-lg"><Network className="size-4" /></span>
          <div className="hidden sm:block">
            <h1 className="text-xs font-semibold text-slate-100">Project graph</h1>
            <p className="text-[10px] text-slate-500">{data?.nodes.length ?? 0} nodes</p>
          </div>
        </div>
        <select
          className={select}
          value={filters.department}
          onChange={(e) => setFilters({ ...filters, department: e.target.value })}
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select className={select} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        {EDGE_TYPES.map((e) => (
          <Button
            key={e.type}
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setFilters({ ...filters, edges: { ...filters.edges, [e.type]: !filters.edges[e.type] } })}
            className={cn(
              "h-7 rounded-lg border px-2 text-[10px]",
              filters.edges[e.type] ? "border-primary/40 bg-primary/15 text-slate-100" : "border-white/10 text-slate-500",
            )}
          >
            {e.label}
          </Button>
        ))}
        <Button size="sm" variant="secondary" className="h-8" onClick={() => setFit((n) => n + 1)}>
          <Maximize className="size-3.5" /> Fit
        </Button>
      </div>

      {selected ? (
        <aside className="absolute top-24 right-5 w-64 rounded-xl border border-white/10 bg-slate-950/90 p-4 text-slate-200 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-right-2">
          <div className="flex items-start gap-3">
            <span className="mt-1 size-2.5 shrink-0 rounded-full bg-primary shadow-[0_0_12px_var(--color-primary)]" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase text-slate-500">{selected.type}</p>
              <h2 className="mt-1 break-words text-sm font-semibold text-slate-100">{selected.label}</h2>
            </div>
            <Button variant="ghost" size="icon" className="size-7 text-slate-500" onClick={() => setSelected(null)} aria-label="Clear selection"><X className="size-3.5" /></Button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/10 pt-3 text-xs">
            <div><p className="text-slate-500">Connections</p><p className="mt-1 font-semibold text-slate-100">{connected}</p></div>
            <div><p className="text-slate-500">Department</p><p className="mt-1 truncate font-semibold text-slate-100">{selected.department ?? "—"}</p></div>
          </div>
          {selected.type === "task" ? (
            <Button size="sm" className="mt-4 w-full" onClick={() => openTask(selected.id.replace(/^task:/, ""))}>
              Open task <ExternalLink className="size-3.5" />
            </Button>
          ) : null}
        </aside>
      ) : null}

      <div className="absolute bottom-5 left-5 grid grid-cols-3 gap-x-4 gap-y-1 rounded-xl border border-white/10 bg-slate-950/85 p-3 text-[10px] text-slate-300 shadow-xl backdrop-blur-md">
        {LEGEND.map((l) => (
          <span key={l.label} className="flex items-center gap-1.5">
            <span className={cn("size-2.5", l.square ? "rounded-[3px]" : "rounded-full")} style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 bg-orange-500" /> Depends on
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0 w-3 border-t border-dashed border-cyan-400" /> Mentions
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full ring-2 ring-emerald-500" /> Live
        </span>
      </div>
      <p className="absolute right-5 bottom-5 rounded-lg border border-white/5 bg-slate-950/70 px-3 py-2 text-[10px] text-slate-500 backdrop-blur">
        Select any node to reveal direct connections · click the canvas to clear
      </p>
    </div>
  );
}
