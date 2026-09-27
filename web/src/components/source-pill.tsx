import { useDataSource } from "@/hooks/use-data-source";
import { cn } from "@/lib/utils";

/** LIVE when the configured backend answers /api/health (and mock mode is not forced on), MOCK otherwise. */
export function SourcePill({ className }: { className?: string }) {
  const { source, mode } = useDataSource();
  const live = source === "live" && mode !== "on";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide",
        live
          ? "border-primary/30 bg-primary/12 text-primary"
          : "border-warning/35 bg-warning/12 text-warning-foreground dark:text-warning",
        className,
      )}
      title={live ? "Connected to the live backend" : "Backend unreachable or mock mode on — mock data"}
    >
      <span className={cn("size-1.5 rounded-full", live ? "animate-live-pulse bg-primary" : "bg-warning")} />
      {live ? "LIVE" : "MOCK"}
    </span>
  );
}
