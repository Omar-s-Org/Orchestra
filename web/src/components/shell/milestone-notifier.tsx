/**
 * Approval happens per milestone: when every task in one is done, toast everyone who can approve it
 * (the PM, or the senior of its department) once, with a link to Review.
 */
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { overviewQuery } from "@/lib/queries";

export function MilestoneNotifier() {
  const { data } = useQuery(overviewQuery());
  const navigate = useNavigate();
  // Remembered for the browser tab, so a reload doesn't toast the same ready milestone again.
  const announced = useRef<Set<string>>(readAnnounced());

  useEffect(() => {
    for (const m of data?.milestones ?? []) {
      const key = `${m.id}:${m.name}`;
      if (!m.ready_for_signoff || !m.can_approve) {
        if (announced.current.delete(key)) saveAnnounced(announced.current); // announce again if it becomes ready again (e.g. after a demo reset)
        continue;
      }
      if (announced.current.has(key)) continue;
      announced.current.add(key);
      saveAnnounced(announced.current);
      toast(`${m.name} is ready for your approval`, {
        description: `All ${m.total} tasks are done.`,
        duration: 15_000,
        action: { label: "Review →", onClick: () => void navigate({ to: "/review" }) },
      });
    }
  }, [data, navigate]);

  return null;
}

const STORE = "orchestra.announced-milestones";
function readAnnounced() {
  try {
    return new Set<string>(JSON.parse(sessionStorage.getItem(STORE) ?? "[]") as string[]);
  } catch {
    return new Set<string>();
  }
}
function saveAnnounced(keys: Set<string>) {
  try {
    sessionStorage.setItem(STORE, JSON.stringify([...keys]));
  } catch {
    /* storage unavailable: fall back to once per page load */
  }
}
