import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Overview } from "@/lib/types";

type Vars = { id: string; action: "approve" | "reopen"; note?: string };

/** Approve / send back. Removes the row from the review queue optimistically, then refetches everything. */
export function useTaskAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, note }: Vars) =>
      action === "approve" ? api.approve(id, note || undefined) : api.reopen(id, note ?? ""),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ["overview"] });
      const prev = qc.getQueryData<Overview>(["overview"]);
      if (prev) {
        qc.setQueryData<Overview>(["overview"], {
          ...prev,
          review_queue: prev.review_queue.filter((r) => r.id !== id),
        });
      }
      return { prev };
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["overview"], ctx.prev);
      if (error instanceof ApiError && error.status === 403) toast.warning(error.message);
      else toast.error(error instanceof Error ? error.message : "Action failed");
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.action === "approve" ? `${vars.id} approved` : `${vars.id} sent back`);
    },
    onSettled: () => {
      void qc.invalidateQueries();
    },
  });
}
