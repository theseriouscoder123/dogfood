import type { SubmissionWindow } from "./types";

export function formatDate(iso: string | null): string {
  if (!iso) return "not set";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(iso)) + " UTC";
}

export const windowLabel: Record<SubmissionWindow, string> = {
  not_open: "Submissions not open yet",
  open: "Submissions open",
  closed: "Submissions closed",
};
