import { cn } from "@/lib/utils";

/** Orchestra mark: three stacked bars, like sections of an orchestra. */
export function Logo({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-lg bg-primary text-primary-foreground",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" width={size * 0.65} height={size * 0.65} fill="none">
        <rect x="4" y="13" width="3.2" height="7" rx="1.6" fill="currentColor" />
        <rect x="10.4" y="8" width="3.2" height="12" rx="1.6" fill="currentColor" opacity="0.85" />
        <rect x="16.8" y="4" width="3.2" height="16" rx="1.6" fill="currentColor" opacity="0.7" />
      </svg>
    </span>
  );
}
