import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Flag } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { AvatarStack, Chip, DueLabel, OverdueBadge } from "@/components/task-bits";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTaskAction } from "@/hooks/use-task-actions";
import { useOpenTask } from "@/hooks/use-task-param";
import { ApiError, api, artifactUrl } from "@/lib/api";
import { money, relativeTime } from "@/lib/format";
import { meQuery, overviewQuery } from "@/lib/queries";
import type { Overview, ReviewItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { RelativeTime } from "@/components/relative-time";

export const Route = createFileRoute("/_shell/review")({
  head: () => ({
    meta: [
      { title: "Review — Orchestra" },
      { name: "description", content: "Tasks waiting for approval from a senior or project manager." },
      { property: "og:title", content: "Review — Orchestra" },
      { property: "og:description", content: "Tasks waiting for approval from a senior or project manager." },
    ],
  }),
  component: ReviewPage,
});

function ReviewPage() {
  const { data: me } = useQuery(meQuery());
  const { data } = useQuery(overviewQuery());
  const navigate = useNavigate();

  useEffect(() => {
    if (me && !me.capabilities.review) void navigate({ to: "/board", replace: true });
  }, [me, navigate]);
  if (!me?.capabilities.review) return null;
  const signoff = me.user.role === "pm" ? (data?.milestones ?? []).filter((m) => m.ready_for_signoff) : [];

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-xl font-semibold tracking-tight">Review</h1>
      {signoff.map((m) => (
        <MilestoneSignoff key={m.id} milestone={m} />
      ))}
      {!data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data.review_queue.length ? (
        signoff.length ? null : 
        <p className="py-12 text-center text-sm text-muted-foreground">Nothing waiting for review.</p>
      ) : (
        data.review_queue.map((item) => <ReviewRow key={item.id} item={item} />)
      )}
    </div>
  );
}

/** PM only: every task in the milestone is done; signing it off closes the milestone. */
function MilestoneSignoff({ milestone }: { milestone: Overview["milestones"][number] }) {
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const qc = useQueryClient();
  const signOff = useMutation({
    mutationFn: () => api.approveMilestone(milestone.id, note.trim() || undefined),
    onSuccess: (r) => {
      toast.success(`${r.name} signed off`);
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not sign off the milestone"),
  });
  return (
    <section className="rounded-xl border border-success/40 bg-success/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Flag className="size-4 text-success" />
          <div>
            <p className="text-sm font-semibold">Milestone ready for sign-off: {milestone.name}</p>
            <p className="text-xs text-muted-foreground">
              All {milestone.total} tasks are done and approved. Signing off closes the milestone.
            </p>
          </div>
        </div>
        {!confirming ? (
          <Button
            size="sm"
            className="bg-success text-success-foreground hover:bg-success/90"
            onClick={() => setConfirming(true)}
          >
            <CheckCircle2 className="size-4" /> Sign off milestone
          </Button>
        ) : null}
      </div>
      {confirming ? (
        <div className="mt-3 space-y-2">
          <Textarea
            id={`signoff-note-${milestone.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note"
            rows={2}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={signOff.isPending}
              className="bg-success text-success-foreground hover:bg-success/90"
              onClick={() => signOff.mutate()}
            >
              Confirm sign-off
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ReviewRow({ item }: { item: ReviewItem }) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<null | "approve" | "reopen">(null);
  const [note, setNote] = useState("");
  const action = useTaskAction();
  const openTask = useOpenTask();
  const c = item.latest_completion;

  return (
    <article className="rounded-xl border bg-card p-4">
      <header className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => openTask(item.id)} className="text-left font-medium hover:underline">
          <span className="font-mono text-xs text-muted-foreground">{item.id}</span> {item.title}
        </button>
        <DueLabel due={item.due} overdue={item.overdue} />
        {item.overdue ? <OverdueBadge /> : null}
        <span className="ml-auto flex items-center gap-2">
          <AvatarStack users={item.workers} />
          <Chip className="tabular-nums">{money(item.cost_usd)}</Chip>
        </span>
      </header>
      {c ? (
        <div className="mt-3 rounded-lg border border-agent/30 bg-agent/5 p-3">
          <p className="mb-1 text-xs text-muted-foreground">
            {c.agent_name ?? c.user.name} · <RelativeTime iso={c.created_at} />
          </p>
          <div className={cn(!expanded && "line-clamp-4")}>
            <Markdown>{c.summary}</Markdown>
          </div>
          <button type="button" onClick={() => setExpanded(!expanded)} className="mt-1 text-xs text-primary hover:underline">
            {expanded ? "Show less" : "Show more"}
          </button>
        </div>
      ) : null}
      {item.artifacts.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {item.artifacts.map((a) => (
            <a key={a.id} href={artifactUrl(a.url)} target="_blank" rel="noreferrer" title={a.name}>
              {a.mime.startsWith("image/") ? (
                <img src={artifactUrl(a.url)} alt={a.name} className="h-16 w-24 rounded-md border bg-muted object-cover" />
              ) : (
                <Chip>{a.name}</Chip>
              )}
            </a>
          ))}
        </div>
      ) : null}
      {mode ? (
        <div className="mt-3 space-y-2">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            autoFocus
            placeholder={mode === "approve" ? "Optional note" : "What needs to change? (required)"}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={action.isPending || (mode === "reopen" && !note.trim())}
              className={mode === "approve" ? "bg-success text-success-foreground hover:bg-success/90" : "bg-warning text-warning-foreground hover:bg-warning/90"}
              onClick={() => action.mutate({ id: item.id, action: mode, note: note.trim() })}
            >
              {mode === "approve" ? "Confirm approve" : "Send back"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex justify-end gap-2">
          {item.allowed_actions.includes("reopen") ? (
            <Button size="sm" className="bg-warning text-warning-foreground hover:bg-warning/90" onClick={() => setMode("reopen")}>
              Send back
            </Button>
          ) : null}
          {item.allowed_actions.includes("approve") ? (
            <Button size="sm" className="bg-success text-success-foreground hover:bg-success/90" onClick={() => setMode("approve")}>
              Approve
            </Button>
          ) : null}
        </div>
      )}
    </article>
  );
}
