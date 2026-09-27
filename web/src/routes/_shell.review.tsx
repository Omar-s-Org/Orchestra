import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Flag } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { meQuery, overviewQuery } from "@/lib/queries";
import type { Overview } from "@/lib/types";

export const Route = createFileRoute("/_shell/review")({
  head: () => ({
    meta: [
      { title: "Review — Orchestra" },
      {
        name: "description",
        content: "Milestones waiting for approval from a senior or the project manager.",
      },
      { property: "og:title", content: "Review — Orchestra" },
      {
        property: "og:description",
        content: "Milestones waiting for approval from a senior or the project manager.",
      },
    ],
  }),
  component: ReviewPage,
});

/** Approval happens per milestone: tasks complete when their agent submits them. */
function ReviewPage() {
  const { data: me } = useQuery(meQuery());
  const { data } = useQuery(overviewQuery());
  const navigate = useNavigate();

  useEffect(() => {
    if (me && !me.capabilities.review) void navigate({ to: "/board", replace: true });
  }, [me, navigate]);
  if (!me?.capabilities.review) return null;
  const ready = (data?.milestones ?? []).filter((m) => m.ready_for_signoff && m.can_approve);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-xl font-semibold tracking-tight">Review</h1>
      {!data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !ready.length ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No milestone is waiting for your approval.
        </p>
      ) : (
        ready.map((m) => <MilestoneSignoff key={m.id} milestone={m} />)
      )}
    </div>
  );
}

/** Every task in the milestone is done; approving it closes the milestone (PM, or the senior of its department). */
function MilestoneSignoff({ milestone }: { milestone: Overview["milestones"][number] }) {
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const qc = useQueryClient();
  const signOff = useMutation({
    mutationFn: () => api.approveMilestone(milestone.id, note.trim() || undefined),
    onSuccess: (r) => {
      toast.success(`${r.name} approved`);
      void qc.invalidateQueries();
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : "Could not approve the milestone"),
  });
  return (
    <section className="rounded-xl border border-success/40 bg-success/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Flag className="size-4 text-success" />
          <div>
            <p className="text-sm font-semibold">Milestone ready for approval: {milestone.name}</p>
            <p className="text-xs text-muted-foreground">
              All {milestone.total} tasks are done. Approving closes the milestone.
            </p>
          </div>
        </div>
        {!confirming ? (
          <Button
            size="sm"
            className="bg-success text-success-foreground hover:bg-success/90"
            onClick={() => setConfirming(true)}
          >
            <CheckCircle2 className="size-4" /> Approve milestone
          </Button>
        ) : null}
      </div>
      {confirming ? (
        <div className="mt-3 space-y-2">
          <Textarea
            id={`approve-note-${milestone.id}`}
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
              Confirm approval
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
