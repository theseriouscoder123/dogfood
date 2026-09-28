"use client";

import { useState } from "react";
import { useDialog } from "@/components/feedback";
import { useRouter } from "next/navigation";
import { Check, Mail, Pencil, ShieldAlert, Trash2, UserPlus, X } from "lucide-react";
import { send } from "@/lib/client";
import type { ConflictRow, JudgeRow, TeamRow, Track } from "@/lib/types";
import { Button, Card, EmptyState, ErrorText, Field, inputClass, Pill, SuccessText } from "@/components/ui";
import { Avatar } from "@/components/visuals";

function TrackPicker({ tracks, value, onChange }: { tracks: Track[]; value: string[]; onChange: (ids: string[]) => void }) {
  if (tracks.length === 0) return <p className="text-sm text-muted">This event has no tracks, so judges can review any project.</p>;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onChange([])}
        className={`rounded-full border px-3 py-1.5 text-[13px] font-semibold transition ${value.length === 0 ? "border-ink bg-ink text-bg" : "border-line text-ink-2 hover:border-line-strong"}`}
      >
        All tracks
      </button>
      {tracks.map((t) => (
        <button
          type="button"
          key={t.id}
          onClick={() => toggle(t.id)}
          className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition ${
            value.includes(t.id) ? "border-primary bg-primary-soft text-primary" : "border-line text-ink-2 hover:border-line-strong"
          }`}
        >
          {value.includes(t.id) && <Check className="size-3.5" />}
          {t.name}
        </button>
      ))}
    </div>
  );
}

export function JudgesManager({ slug, judges, tracks, teams, conflicts }: { slug: string; judges: JudgeRow[]; tracks: Track[]; teams: TeamRow[]; conflicts: ConflictRow[] }) {
  const ask = useDialog();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [inviteTracks, setInviteTracks] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ id: string; tracks: string[] } | null>(null);
  const trackName = (id: string) => tracks.find((t) => t.id === id)?.name ?? "?";
  const base = `/api/events/${slug}`;

  async function run(method: string, path: string, body?: unknown) {
    setPending(true);
    setNotice(null);
    const r = await send<Record<string, unknown>>(method, path, body);
    setPending(false);
    if (!r.ok) {
      setError(r.message);
      return null;
    }
    setError(null);
    router.refresh();
    return r.data ?? {};
  }

  const totalAssigned = judges.reduce((n, j) => n + j.assigned, 0);
  const totalDone = judges.reduce((n, j) => n + j.submitted, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["Judges", judges.length],
          ["Accounts activated", `${judges.filter((j) => j.hasAccount).length}/${judges.length}`],
          ["Reviews submitted", `${totalDone}/${totalAssigned}`],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <div className="font-display text-3xl font-extrabold">{value}</div>
            <div className="text-sm text-muted">{label}</div>
          </div>
        ))}
      </div>

      <Card title="Invite a judge" description="Judges only see the projects assigned to them.">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            const email = String(f.get("email"));
            const d = await run("POST", `${base}/judges`, { email, name: f.get("name") || undefined, trackIds: inviteTracks });
            if (d) {
              form.reset();
              setInviteTracks([]);
              setNotice(`${email} is now a judge${d.emailed ? " and has been emailed an invitation" : ""}.`);
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" required>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 mt-[3px] size-4 -translate-y-1/2 text-muted" />
                <input name="email" type="email" required placeholder="judge@company.com" className={`${inputClass} pl-10`} />
              </div>
            </Field>
            <Field label="Name" hint="Optional; they can change it later.">
              <input name="name" maxLength={100} className={inputClass} />
            </Field>
          </div>
          <Field label="Tracks this judge reviews">
            <div className="mt-2">
              <TrackPicker tracks={tracks} value={inviteTracks} onChange={setInviteTracks} />
            </div>
          </Field>
          <Button type="submit" disabled={pending}>
            <UserPlus className="size-4" /> Invite judge
          </Button>
          <SuccessText>{notice}</SuccessText>
        </form>
      </Card>

      <Card title="Panel" padded={false}>
        {judges.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No judges yet">Invite your first judge above.</EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-y border-line bg-surface-2 text-left text-xs font-bold uppercase tracking-wider text-muted">
                  <th className="px-5 py-3 font-bold sm:px-6">Judge</th>
                  <th className="px-3 py-3 font-bold">Tracks</th>
                  <th className="px-3 py-3 font-bold">Progress</th>
                  <th className="px-3 py-3 font-bold">Status</th>
                  <th className="px-5 py-3 sm:px-6" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {judges.map((j) => (
                  <tr key={j.id} className="align-middle">
                    <td className="px-5 py-3 sm:px-6">
                      <div className="flex items-center gap-3">
                        <Avatar name={j.name} size={34} />
                        <div className="min-w-0">
                          <div className="font-semibold">
                            {j.name} {j.externalId && <span className="font-mono text-xs text-muted">{j.externalId}</span>}
                          </div>
                          <div className="truncate text-xs text-muted">{j.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="max-w-72 px-3 py-3">
                      {editing?.id === j.id ? (
                        <div className="space-y-2">
                          <TrackPicker tracks={tracks} value={editing.tracks} onChange={(ids) => setEditing({ id: j.id, tracks: ids })} />
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              disabled={pending}
                              onClick={async () => {
                                if (await run("PATCH", `${base}/judges/${j.id}`, { trackIds: editing.tracks })) setEditing(null);
                              }}
                            >
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(null)} aria-label="Cancel">
                              <X className="size-4" />
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {j.trackIds.length === 0 ? <Pill>All tracks</Pill> : j.trackIds.map((t) => <Pill key={t}>{trackName(t)}</Pill>)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2">
                          <div className="h-full rounded-full bg-success" style={{ width: `${j.assigned ? (j.submitted / j.assigned) * 100 : 0}%` }} />
                        </div>
                        <span className="text-xs font-semibold tabular-nums text-ink-2">
                          {j.submitted}/{j.assigned}
                        </span>
                      </div>
                      {(j.recused > 0 || j.conflicts > 0) && (
                        <div className="mt-1 text-[11px] text-muted">
                          {j.recused > 0 && `${j.recused} recused `}
                          {j.conflicts > 0 && `${j.conflicts} conflict${j.conflicts === 1 ? "" : "s"}`}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">{j.hasAccount ? <Pill tone="success">Active</Pill> : <Pill tone="warn">Invited</Pill>}</td>
                    <td className="px-5 py-3 text-right sm:px-6">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing({ id: j.id, tracks: j.trackIds })} aria-label={`Edit tracks for ${j.name}`}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={async () => (await ask.confirm({ title: `Remove ${j.name}?`, confirmLabel: "Remove", danger: true })) && void run("DELETE", `${base}/judges/${j.id}`)}
                          aria-label={`Remove ${j.name}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Conflicts of interest" description="Judges are never assigned to these teams.">
        {conflicts.length > 0 && (
          <ul className="mb-5 divide-y divide-line">
            {conflicts.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2.5 text-sm">
                <ShieldAlert className="size-4 shrink-0 text-warn" />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{c.judge.name}</span> <span className="text-muted">×</span> <span className="font-semibold">{c.team.name}</span>
                  {c.note && <span className="text-muted"> · {c.note}</span>}
                </span>
                <Pill>{c.source === "detected" ? "Auto-detected" : "Declared"}</Pill>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => void run("DELETE", `${base}/conflicts/${c.id}`)} aria-label="Remove conflict">
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            const d = await run("POST", `${base}/conflicts`, { judgeId: f.get("judgeId"), teamId: f.get("teamId"), note: f.get("note") });
            if (d) {
              form.reset();
              const affected = Number(d.affectedAssignments ?? 0);
              setNotice(affected ? `Conflict recorded. ${affected} existing assignment(s) now need reassigning.` : "Conflict recorded.");
            }
          }}
        >
          <select name="judgeId" required defaultValue="" className={`${inputClass} mt-0`}>
            <option value="" disabled>
              Judge…
            </option>
            {judges.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </select>
          <select name="teamId" required defaultValue="" className={`${inputClass} mt-0`}>
            <option value="" disabled>
              Team…
            </option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.projects[0] ? `: ${t.projects[0].title}` : ""}
              </option>
            ))}
          </select>
          <input name="note" maxLength={500} placeholder="Reason (optional)" className={`${inputClass} mt-0`} />
          <Button type="submit" disabled={pending || judges.length === 0}>
            Add
          </Button>
        </form>
      </Card>

      <ErrorText>{error}</ErrorText>
    </div>
  );
}
