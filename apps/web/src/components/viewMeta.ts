import { Gavel, Settings2, Users } from "lucide-react";
import type { Role } from "@/lib/types";

/** Labels and icons for the three views (see lib/view.ts). Shared by server and client components. */
export const VIEWS: Record<Role, { label: string; blurb: string; icon: typeof Users }> = {
  participant: { label: "Participant", blurb: "Your teams, projects and hackathons to join", icon: Users },
  judge: { label: "Judge", blurb: "Your review queues and deadlines", icon: Gavel },
  organizer: { label: "Organizer", blurb: "The hackathons you run", icon: Settings2 },
};
