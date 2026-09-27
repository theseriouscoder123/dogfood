"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, Crown, FileText, Link2, LogOut, Mail, Pencil, Plus, UserMinus, X } from "lucide-react";
import { send } from "@/lib/client";
import type { MyTeam } from "@/lib/types";
import { Button, buttonClass, Card, ErrorText, inputClass, Pill, SuccessText } from "@/components/ui";
import { Avatar } from "@/components/visuals";

type WithTeam = Extract<MyTeam, { team: object }>;

export function CreateTeam({ slug }: { slug: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const r = await send("POST", `/api/events/${slug}/teams`, { name: new FormData(e.currentTarget).get("name") });
        setPending(false);
        if (!r.ok) return setError(r.message);
        router.refresh();
      }}
    >
      <input name="name" required maxLength={80} placeholder="Team name, e.g. Night Owls" className={inputClass} />
      <Button type="submit" disabled={pending} className="w-full">
        <Plus className="size-4" /> {pending ? "Creating…" : "Create team"}
      </Button>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

export function TeamPanel({ slug, data, meId, canChange, submissionsOpen }: { slug: string; data: WithTeam; meId: string; canChange: boolean; submissionsOpen: boolean }) {
  const router = useRouter();
  const { team, myRole, maxTeamSize } = data;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newLink, setNewLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const isCaptain = myRole === "captain";
  const full = team.members.length >= maxTeamSize;
  const project = team.projects[0];

  async function act(method: string, path: string, body?: unknown) {
    setNotice(null);
    const r = await send(method, path, body);
    if (!r.ok) {
      setError(r.message);
      return null;
    }
    setError(null);
    router.refresh();
    return r.data ?? {};
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <Card
          title={
            <span className="flex items-center gap-2">
              {team.name}
              {isCaptain && <Pill tone="primary">Captain</Pill>}
            </span>
          }
          description={`${team.members.length} of ${maxTeamSize} members`}
          actions={
            canChange && (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  if (!confirm(team.members.length === 1 ? "You're the last member, so leaving deletes the team. Continue?" : "Leave this team?")) return;
                  if ((await act("POST", `/api/events/${slug}/teams/mine/leave`)) !== null) router.push(`/events/${slug}`);
                }}
              >
                <LogOut className="size-4" /> Leave
              </Button>
            )
          }
        >
          <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(team.members.length / maxTeamSize) * 100}%` }} />
          </div>
          <ul className="divide-y divide-line">
            {team.members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-3">
                <Avatar name={m.name} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-semibold">
                    {m.name}
                    {m.id === meId && <span className="text-xs font-medium text-muted">(you)</span>}
                    {m.role === "captain" && <Crown className="size-4 text-accent" aria-label="captain" />}
                  </div>
                  <div className="truncate text-xs text-muted">{m.email}</div>
                </div>
                {canChange && isCaptain && m.id !== meId && (
                  <Button variant="ghost" size="sm" onClick={() => void act("DELETE", `/api/events/${slug}/teams/mine/members/${m.id}`)} aria-label={`Remove ${m.name}`}>
                    <UserMinus className="size-4" />
                  </Button>
                )}
              </li>
            ))}
            {Array.from({ length: Math.max(0, maxTeamSize - team.members.length) }).map((_, i) => (
              <li key={`empty${i}`} className="flex items-center gap-3 py-3 text-sm text-muted">
                <span className="grid size-[38px] place-items-center rounded-full border-2 border-dashed border-line-strong">
                  <Plus className="size-4" />
                </span>
                Open seat
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Project">
          {project ? (
            <div className="flex flex-wrap items-center gap-4">
              <div className="grid size-12 place-items-center rounded-xl bg-primary-soft text-primary">
                <FileText className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <Link href={`/events/${slug}/projects/${project.id}`} className="text-lg font-bold hover:text-primary">
                  {project.title}
                </Link>
                <div className="mt-1">
                  <Pill tone={project.status === "submitted" ? "success" : "warn"}>{project.status === "submitted" ? "Submitted" : "Draft, not submitted yet"}</Pill>
                </div>
              </div>
              {submissionsOpen && (
                <Link href={`/events/${slug}/projects/${project.id}/edit`} className={buttonClass(project.status === "submitted" ? "secondary" : "primary")}>
                  <Pencil className="size-4" /> {project.status === "submitted" ? "Edit" : "Continue editing"}
                </Link>
              )}
            </div>
          ) : submissionsOpen ? (
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={async (e) => {
                e.preventDefault();
                const d = (await act("POST", `/api/events/${slug}/projects`, { title: new FormData(e.currentTarget).get("title") })) as { project?: { id: string } } | null;
                if (d?.project) router.push(`/events/${slug}/projects/${d.project.id}/edit`);
              }}
            >
              <input name="title" required maxLength={120} placeholder="What are you building?" className={`${inputClass} mt-0`} />
              <Button type="submit">Start a draft</Button>
            </form>
          ) : (
            <p className="text-sm text-muted">Submissions aren&apos;t open right now.</p>
          )}
        </Card>
        <ErrorText>{error}</ErrorText>
      </div>

      {canChange && (
        <div className="space-y-4">
          <Card title="Invite teammates" description={full ? "Your team is full." : "Share a link, or send an invite by email."}>
            {!full && (
              <div className="space-y-4">
                <div>
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={async () => {
                      const d = (await act("POST", `/api/events/${slug}/teams/mine/invites`, {})) as { invite?: { joinPath: string } } | null;
                      if (d?.invite) {
                        setNewLink(`${window.location.origin}${d.invite.joinPath}`);
                        setCopied(false);
                      }
                    }}
                  >
                    <Link2 className="size-4" /> Create invite link
                  </Button>
                  {newLink && (
                    <div className="mt-3 rounded-xl border border-primary/25 bg-primary-soft p-3">
                      <div className="flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate text-xs text-ink">{newLink}</code>
                        <button
                          type="button"
                          onClick={async () => {
                            await navigator.clipboard.writeText(newLink);
                            setCopied(true);
                          }}
                          className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-ink"
                          aria-label="Copy link"
                        >
                          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                        </button>
                      </div>
                      <p className="mt-2 text-[11px] text-muted">Shown once. Works for 3 days or 10 joins.</p>
                    </div>
                  )}
                </div>
                <form
                  className="space-y-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const email = String(new FormData(form).get("email"));
                    const d = await act("POST", `/api/events/${slug}/teams/mine/invites/email`, { email });
                    if (d) {
                      form.reset();
                      setNotice(`Invite sent to ${email}.`);
                    }
                  }}
                >
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 mt-[3px] size-4 -translate-y-1/2 text-muted" />
                    <input name="email" type="email" required placeholder="teammate@example.com" className={`${inputClass} pl-10`} />
                  </div>
                  <Button type="submit" className="w-full">
                    Send invite
                  </Button>
                </form>
                <SuccessText>{notice}</SuccessText>
              </div>
            )}
            {team.invites.length > 0 && (
              <div className="mt-5 border-t border-line pt-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Active invites</p>
                <ul className="space-y-2">
                  {team.invites.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs">
                      <span className="text-ink-2">
                        {i.uses}/{i.maxUses} used · expires {new Date(i.expiresAt).toLocaleDateString()}
                      </span>
                      <button type="button" className="text-muted hover:text-danger" aria-label="Revoke invite" onClick={() => void act("DELETE", `/api/events/${slug}/teams/mine/invites/${i.id}`)}>
                        <X className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
