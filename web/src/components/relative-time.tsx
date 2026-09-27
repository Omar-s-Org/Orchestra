import { useSyncExternalStore } from "react";

import { absoluteTime, relativeTime } from "@/lib/format";

// One shared 15 s clock, so "3 seconds ago" keeps moving while the page stays open.
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
function subscribe(listener: () => void) {
  listeners.add(listener);
  timer ??= setInterval(() => {
    now = Date.now();
    listeners.forEach((l) => l());
  }, 15_000);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** "3 minutes ago" that re-renders as time passes; the exact time is in the tooltip. */
export function RelativeTime({ iso }: { iso: string }) {
  useSyncExternalStore(subscribe, () => now, () => now);
  return <time dateTime={iso} title={absoluteTime(iso)}>{relativeTime(iso)}</time>;
}
