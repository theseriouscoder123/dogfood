// Which hat someone is wearing: Participant, Judge or Organizer. Purely presentation: it decides
// what the dashboard, the header and the event tabs show, never what anyone may do. The API
// enforces permissions exactly the same whichever view is picked.
import { cookies } from "next/headers";
import type { Me, Role } from "./types";

export type View = Role;
export const VIEW_COOKIE = "dogfood-view";

/** The views someone can switch between. Everyone signed in can participate. */
export function viewsFor(me: Me): View[] {
  if (!me.user) return [];
  const roles = new Set(me.roles.map((r) => r.role));
  return [
    "participant",
    ...(roles.has("judge") ? (["judge"] as const) : []),
    ...(roles.has("organizer") || me.user.isAdmin ? (["organizer"] as const) : []),
  ];
}

/** The saved view, or, the first time, the one with work to do: organizing, then judging. */
export async function currentView(me: Me): Promise<View> {
  const views = viewsFor(me);
  const saved = (await cookies()).get(VIEW_COOKIE)?.value;
  if (saved && (views as string[]).includes(saved)) return saved as View;
  return views.includes("organizer") ? "organizer" : views.includes("judge") ? "judge" : "participant";
}
