import Link from "next/link";
import { Link2Off, UsersRound } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { getMe } from "@/lib/session";
import type { InvitePreview } from "@/lib/types";
import { buttonClass, EmptyState } from "@/components/ui";
import { Avatar, Cover } from "@/components/visuals";
import { JoinButton } from "./JoinButton";

export const metadata = { title: "Join a team" };

const reasons: Record<Exclude<InvitePreview["status"], "valid">, string> = {
  expired: "This invite link has expired. Ask your team for a new one.",
  revoked: "This invite link was revoked by the team.",
  used_up: "This invite link has already been used the maximum number of times.",
  team_full: "This team is already full.",
  registration_closed: "Team formation for this event has closed.",
  registration_not_open: "Registration for this event hasn't opened yet.",
};

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const me = await getMe();
  const preview = await api<InvitePreview>(`/api/invites/${encodeURIComponent(token)}`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  });

  if (!preview) {
    return (
      <div className="mx-auto max-w-md px-4 pt-16">
        <EmptyState icon={<Link2Off className="size-5" />} title="This invite link isn't valid">
          Check that you copied the whole link.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 pt-12">
      <div className="overflow-hidden rounded-3xl border border-line bg-surface shadow-lift">
        <Cover seed={preview.event.slug} label={preview.event.name} monogram={false} rounded="rounded-none" className="h-28 w-full" />
        <div className="-mt-10 px-6 pb-7 text-center">
          <div className="mx-auto w-fit rounded-full bg-surface p-1">
            <Avatar name={preview.team.name} size={72} />
          </div>
          <p className="mt-3 text-sm font-semibold text-muted">You&apos;re invited to join</p>
          <h1 className="text-2xl font-extrabold">{preview.team.name}</h1>
          <p className="mt-1 text-sm text-muted">
            at <span className="font-semibold text-ink">{preview.event.name}</span>
          </p>
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-ink-2">
            <UsersRound className="size-3.5" /> {preview.team.memberCount} of {preview.event.maxTeamSize} seats taken
          </p>
          <div className="mt-6">
            {preview.status !== "valid" ? (
              <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">{reasons[preview.status]}</p>
            ) : me.user ? (
              <JoinButton token={token} slug={preview.event.slug} />
            ) : (
              <div className="grid gap-2">
                <Link href={`/register?next=/join/${token}`} className={buttonClass("primary", "lg", "w-full")}>
                  Create an account to join
                </Link>
                <Link href={`/login?next=/join/${token}`} className={buttonClass("secondary", "lg", "w-full")}>
                  I already have an account
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
