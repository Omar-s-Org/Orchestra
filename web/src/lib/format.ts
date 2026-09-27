import { formatDistanceToNowStrict } from "date-fns";

import type { Role, Status } from "./types";

export const ROLE_LABEL: Record<Role, string> = {
  pm: "Project Manager",
  senior: "Senior",
  junior: "Junior",
};

export const STATUS_LABEL: Record<Status, string> = {
  todo: "To do",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
};

export const STATUS_ORDER: Status[] = ["todo", "in_progress", "review", "done"];

/** "$0.42", "$12.30" once the amount reaches $10. */
export function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function relativeTime(iso: string): string {
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
}

export function absoluteTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}
