/**
 * Reset demo (LOVABLE_PLAN §12): PM-only "Reset demo" button (restarts the demo from the beginning), a live status pill while it runs,
 * a toast for every task that lands in review, and a toast when the run ends.
 * Only shown against the live backend (mock mode has no demo runner).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useDataSource } from "@/hooks/use-data-source";
import { ApiError, api } from "@/lib/api";
import type { Me } from "@/lib/types";

export function DemoControl({ me }: { me: Me }) {
  const { source } = useDataSource();
  const live = source === "live";
  const isPm = me.user.role === "pm";
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [real, setReal] = useState<string[]>([]);
  // Hassan works his task live with his own Claude Code, so he is ticked by default.
  const openReset = () => {
    setReal(s?.available_cast.some((u) => u.id === "hassan") ? ["hassan"] : []);
    setConfirming(true);
  };

  const status = useQuery({
    queryKey: ["demo-status"],
    queryFn: api.demoStatus,
    enabled: live,
    retry: false,
    refetchInterval: (q) => (q.state.data?.running ? 2000 : 10_000),
  });
  const s = status.data;

  // One toast per task that reaches review, and one when the run ends.
  const announced = useRef(new Set<string>());
  const wasRunning = useRef(false);
  useEffect(() => {
    if (!s) return;
    // A new run reuses the same task ids: forget what the previous run announced.
    if (s.running && !wasRunning.current) announced.current.clear();
    for (const w of s.waiting_for_approval) {
      if (announced.current.has(w.id)) continue;
      announced.current.add(w.id);
      if (me.capabilities.review) {
        toast(`${w.id} ${w.title} is waiting for your approval`, {
          action: { label: "Review →", onClick: () => void navigate({ to: "/review" }) },
        });
      }
    }
    if (wasRunning.current && !s.running) {
      if (s.end_reason?.startsWith("complete")) {
        toast.success("Demo complete: the beta milestone shipped.", {
          description: isPm
            ? "Sign off the milestone in Review."
            : "Open the board to see the result.",
          action: isPm
            ? { label: "Review →", onClick: () => void navigate({ to: "/review" }) }
            : { label: "Board", onClick: () => void navigate({ to: "/board" }) },
        });
      } else if (s.end_reason) {
        toast(`Demo ended: ${s.end_reason}`);
      }
      void qc.invalidateQueries();
    }
    wasRunning.current = s.running;
  }, [s, me.capabilities.review, isPm, navigate, qc]);

  const onError = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : "Something went wrong");
  const run = useMutation({
    // Reset = stop any run in progress, then start from the beginning.
    mutationFn: async () => {
      if (s?.running) await api.demoStop();
      return api.demoRun(real);
    },
    onSuccess: async (next) => {
      announced.current.clear();
      qc.setQueryData(["demo-status"], next);
      // The data was reset to Lumen: drop every cached query so no screen shows the old project.
      await qc.invalidateQueries();
      toast.success("Demo reset to the start", {
        description: next.real.length
          ? `${next.real.map((u) => u.name).join(", ")} work their tasks with their own agents.`
          : "Every agent is simulated.",
      });
    },
    onError,
  });
  const stop = useMutation({
    mutationFn: api.demoStop,
    onSuccess: (next) => qc.setQueryData(["demo-status"], next),
    onError,
  });

  if (!live) return null;

  const resetDialog = (
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the demo?</AlertDialogTitle>
            <AlertDialogDescription>
              This resets the project to the start. Tasks of the people ticked below wait for their
              own Claude Code (T-8 for Hassan); the other agents are simulated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {s?.available_cast.length ? (
            <fieldset className="space-y-2 rounded-lg border p-3">
              <legend className="px-1 text-xs font-medium">Real agents (optional)</legend>
              <p className="text-xs text-muted-foreground">
                Tick anyone working live with their own Claude Code. The simulator leaves their
                tasks alone.
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {s.available_cast.map((u) => (
                  <label
                    key={u.id}
                    htmlFor={`real-${u.id}`}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      id={`real-${u.id}`}
                      checked={real.includes(u.id)}
                      onCheckedChange={(on) =>
                        setReal((r) => (on ? [...r, u.id] : r.filter((x) => x !== u.id)))
                      }
                    />
                    {u.name}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => run.mutate()}>Reset demo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
  );

  if (s?.running) {
    const waiting = s.waiting_for_approval.length;
    return (
      <div className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-agent/40 bg-agent/10 py-1 pr-1 pl-3 text-xs font-medium">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-agent opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex size-2 rounded-full bg-agent" />
        </span>
        <span className="tabular-nums">
          Demo running · {s.progress?.done ?? 0}/{s.progress?.total ?? 0}
        </span>
        {waiting > 0 && me.capabilities.review ? (
          <Button
            size="sm"
            variant="secondary"
            className="h-6 px-2 text-xs"
            onClick={() => void navigate({ to: "/review" })}
          >
            {waiting} to review
          </Button>
        ) : null}
        {isPm ? (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={openReset} disabled={run.isPending}>
            <RotateCcw className="size-3" /> Reset
          </Button>
        ) : null}
        {isPm ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={() => stop.mutate()}
            disabled={stop.isPending}
          >
            <Square className="size-3" /> Stop
          </Button>
        ) : null}
        {resetDialog}
      </div>
    );
  }

  if (!isPm) return null;

  return (
    <>
      <Button
        size="sm"
        className="h-8"
        onClick={openReset}
        disabled={run.isPending}
      >
        {run.isPending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RotateCcw className="size-3.5" />
        )}
        Reset demo
      </Button>
      {resetDialog}
    </>
  );
}
