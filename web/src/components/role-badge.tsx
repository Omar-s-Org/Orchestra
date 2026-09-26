import { cn } from "@/lib/utils";
import { ROLE_LABEL } from "@/lib/format";
import type { Role } from "@/lib/types";

const STYLES: Record<Role, string> = {
  pm: "bg-role-pm/12 text-role-pm border-role-pm/25",
  senior: "bg-role-senior/12 text-role-senior border-role-senior/25",
  junior: "bg-role-junior/12 text-role-junior border-role-junior/25",
};

export function RoleBadge({
  role,
  className,
  short = false,
}: {
  role: Role;
  className?: string;
  short?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none",
        STYLES[role],
        className,
      )}
    >
      {short ? (role === "pm" ? "PM" : ROLE_LABEL[role]) : ROLE_LABEL[role]}
    </span>
  );
}
