"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, UserPlus, Users, X } from "lucide-react";
import { send } from "@/lib/client";
import { Button, Card, EmptyState, Field, inputClass, Pill } from "@/components/ui";
import { Avatar } from "@/components/visuals";
import { useToast } from "@/components/feedback";
import { ago } from "@/components/NotificationBell";

type Post = {
  id: string;
  kind: "individual" | "team";
  note: string;
  skills: string[];
  updatedAt: string;
  mine: boolean;
  person: { name: string; profile: string; avatarUrl: string | null; headline: string };
  team: { name: string; members: number; openSpots: number } | null;
};
export type FinderData = {
  maxTeamSize: number;
  registrationOpen: boolean;
  me: { onTeam: boolean; teamName: string | null; canInvite: boolean; post: { kind: string; note: string; skills: string[] } | null } | null;
  posts: Post[];
};

export function TeamFinder({ slug, data, signedIn }: { slug: string; data: FinderData; signedIn: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<"individual" | "team">(data.me?.onTeam ? "individual" : "team");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(data.me?.post?.note ?? "");
  const [skills, setSkills] = useState((data.me?.post?.skills ?? []).join(", "));
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const base = `/api/events/${slug}/team-finder`;
  const myKind = data.me?.onTeam ? "team" : "individual";

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.posts.filter((p) => p.kind === tab).filter((p) => !needle || [p.note, p.person.name, p.person.headline, p.team?.name ?? "", ...p.skills].join(" ").toLowerCase().includes(needle));
  }, [data.posts, tab, q]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const r = await send("PUT", base, { kind: myKind, note, skills: skills.split(",").map((s) => s.trim()).filter(Boolean) });
    if (!r.ok) return toast.error(r.message);
    toast.success("Your post is live");
    setEditing(false);
    router.refresh();
  }

  async function remove() {
    const r = await send("DELETE", base);
    if (!r.ok) return toast.error(r.message);
    toast.success("Post removed");
    router.refresh();
  }

  async function invite(p: Post) {
    const r = await send("POST", `${base}/${p.id}/invite`);
    if (!r.ok) return toast.error(r.message);
    setInvited((s) => new Set(s).add(p.id));
    toast.success(`Invite sent to ${p.person.name}`);
  }

  const counts = { individual: data.posts.filter((p) => p.kind === "individual").length, team: data.posts.filter((p) => p.kind === "team").length };

  return (
    <>
      {signedIn && data.registrationOpen && (
        <Card>
          {!editing ? (
            <div className="flex flex-wrap items-center gap-4">
              <span className="grid size-10 place-items-center rounded-xl bg-primary-soft text-primary">{data.me?.onTeam ? <Users className="size-5" /> : <UserPlus className="size-5" />}</span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{data.me?.post ? "Your post is live" : data.me?.onTeam ? `Looking for people for ${data.me.teamName}?` : "Looking for a team?"}</p>
                <p className="text-sm text-muted">{data.me?.post ? data.me.post.note || "No note" : "Post once, and teams or builders can find you."}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setEditing(true)}>
                  {data.me?.post ? "Edit" : "Post"}
                </Button>
                {data.me?.post && (
                  <Button size="sm" variant="ghost" onClick={remove}>
                    <X className="size-4" /> Remove
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <form onSubmit={save} className="space-y-4">
              <Field label={data.me?.onTeam ? "Who are you looking for?" : "What do you bring?"}>
                <textarea className={inputClass} rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={data.me?.onTeam ? "A designer who can prototype in Figma" : "Backend dev, into data pipelines and Go"} />
              </Field>
              <Field label="Skills" hint="Comma separated">
                <input className={inputClass} value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="Go, PostgreSQL, Figma" />
              </Field>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button type="submit">Save</Button>
              </div>
            </form>
          )}
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {(["team", "individual"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${tab === k ? "border-ink bg-ink text-bg" : "border-line bg-surface text-ink-2 hover:border-line-strong"}`}
            >
              {k === "team" ? "Teams with room" : "People looking"} <span className="ml-1 opacity-70">{counts[k]}</span>
            </button>
          ))}
        </div>
        <label className="relative w-full sm:w-64">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input className={`${inputClass} mt-0 pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search skills or names" />
        </label>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={<Users className="size-5" />} title={tab === "team" ? "No teams are looking right now" : "Nobody's looking right now"} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {shown.map((p) => (
            <li key={p.id} className="flex flex-col rounded-2xl border border-line bg-surface p-4 shadow-card">
              <div className="flex items-start gap-3">
                <Link href={`/u/${p.person.profile}`}>
                  <Avatar name={p.person.name} src={p.person.avatarUrl} size={40} />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link href={`/u/${p.person.profile}`} className="block truncate font-bold hover:text-primary">
                    {p.team ? p.team.name : p.person.name}
                  </Link>
                  <p className="truncate text-xs text-muted">{p.team ? `${p.team.members} of ${data.maxTeamSize} · posted by ${p.person.name}` : p.person.headline || "Builder"}</p>
                </div>
                {p.team && <Pill tone="success">{p.team.openSpots} open</Pill>}
              </div>
              {p.note && <p className="mt-3 flex-1 text-sm text-ink-2">{p.note}</p>}
              {p.skills.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {p.skills.map((s) => (
                    <span key={s} className="rounded-md border border-line px-1.5 py-0.5 text-[11px] font-semibold text-ink-2">
                      {s}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-xs text-muted">
                <span>{ago(p.updatedAt)}</span>
                {p.kind === "individual" && data.me?.canInvite && !p.mine && (
                  <Button size="sm" variant="secondary" disabled={invited.has(p.id)} onClick={() => invite(p)}>
                    <UserPlus className="size-3.5" /> {invited.has(p.id) ? "Invited" : "Invite to team"}
                  </Button>
                )}
                {p.kind === "team" && !data.me?.onTeam && !p.mine && (
                  <Link href={`/u/${p.person.profile}`} className="font-semibold text-primary hover:underline">
                    View profile
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
