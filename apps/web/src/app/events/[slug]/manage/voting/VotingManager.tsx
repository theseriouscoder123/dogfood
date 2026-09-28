"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, KeyRound, Lock, Mail, ShieldCheck, Ticket, UserRound } from "lucide-react";
import { fromLocalInput, send, toLocalInput } from "@/lib/client";
import type { VotingAdmin, VotingMode } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { Button, Card, ErrorText, Field, inputClass, Pill, SuccessText } from "@/components/ui";

const MODES: Array<{ mode: VotingMode; title: string; icon: typeof Mail; body: string; strength: "Recommended" | "Strongest" | "Weakest" }> = [
  {
    mode: "email",
    title: "Verified email",
    icon: Mail,
    body: "A one-time link confirms each voter's inbox. One inbox, one ballot.",
    strength: "Recommended",
  },
  {
    mode: "invite",
    title: "Ballot codes",
    icon: Ticket,
    body: "Single-use codes you hand out, for in-person events.",
    strength: "Strongest",
  },
  {
    mode: "accounts",
    title: "Any account",
    icon: UserRound,
    body: "Anyone with an account. Easiest, and the easiest to game.",
    strength: "Weakest",
  },
];

const WINDOW_LABEL = { off: "Off", not_open: "Scheduled", open: "Open now", closed: "Closed" } as const;
const KIND_LABEL: Record<VotingMode, string> = { email: "email", invite: "code", accounts: "account" };

export function VotingManager({ slug, data }: { slug: string; data: VotingAdmin }) {
  const router = useRouter();
  const s = data.settings;
  const [enabled, setEnabled] = useState(s.opensAt !== null);
  const [opensAt, setOpensAt] = useState(toLocalInput(s.opensAt ?? data.submissionsCloseAt));
  const [closesAt, setClosesAt] = useState(toLocalInput(s.closesAt));
  const [mode, setMode] = useState<VotingMode>(s.mode);
  const [votes, setVotes] = useState(s.votesPerVoter);
  const [domains, setDomains] = useState(s.voterDomains.join(", "));
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const t = data.turnout;

  async function save() {
    setPending(true);
    const r = await send("PUT", `/api/events/${slug}/voting/settings`, {
      opensAt: enabled ? fromLocalInput(opensAt) : null,
      closesAt: enabled ? fromLocalInput(closesAt) : null,
      mode,
      votesPerVoter: votes,
      voterDomains: domains
        .split(/[\s,]+/)
        .map((d) => d.trim())
        .filter(Boolean),
    });
    setPending(false);
    setNotice(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.message });
    if (r.ok) router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Status", value: WINDOW_LABEL[data.window], sub: s.closesAt ? `closes ${formatDate(s.closesAt)}` : "not scheduled" },
          {
            label: "Voters",
            value: String(t.voters),
            sub:
              (Object.entries(t.byKind) as Array<[VotingMode, number]>)
                .map(([k, n]) => `${n} via ${KIND_LABEL[k]}`)
                .join(" · ") || "nobody yet",
          },
          { label: "Ballots with picks", value: String(t.ballots), sub: `${t.choices} votes cast in total` },
          {
            label: "Last ballot",
            value: t.lastBallotAt ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(t.lastBallotAt)) : "–",
            sub: "UTC",
          },
        ].map((x) => (
          <div key={x.label} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
            <div className="truncate font-display text-2xl font-extrabold tabular-nums">{x.value}</div>
            <div className="text-sm font-semibold text-ink-2">{x.label}</div>
            <div className="mt-0.5 truncate text-xs text-muted">{x.sub}</div>
          </div>
        ))}
      </div>
      <p className="flex items-center gap-2 text-sm text-muted">
        <Lock className="size-4 shrink-0" /> Counts stay sealed until voting closes.
      </p>

      <Card title="Settings" description={data.locked ? "People have voted, so how they vote is locked. You can still move the dates." : undefined}>
        <div className="space-y-6">
          <label className="flex items-center gap-3 text-sm font-semibold">
            <input type="checkbox" checked={enabled} disabled={data.locked} onChange={(e) => setEnabled(e.target.checked)} className="size-5 accent-[var(--primary)]" />
            Run a community vote for this event
          </label>

          {enabled && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Voting opens (UTC)" hint="No earlier than the submission deadline, so everyone votes on the same final list.">
                  <input type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} className={inputClass} />
                </Field>
                <Field label="Voting closes (UTC)">
                  <input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} className={inputClass} />
                </Field>
              </div>

              <div>
                <p className="mb-2 text-sm font-semibold">How voters prove who they are</p>
                <div className="grid gap-3 md:grid-cols-3">
                  {MODES.map((m) => (
                    <button
                      key={m.mode}
                      type="button"
                      disabled={data.locked}
                      aria-pressed={mode === m.mode}
                      onClick={() => setMode(m.mode)}
                      className={`rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed ${mode === m.mode ? "border-primary bg-primary-soft ring-2 ring-primary/20" : "border-line bg-surface hover:border-line-strong"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <m.icon className="size-5 text-primary" />
                        <Pill tone={m.strength === "Weakest" ? "warn" : m.strength === "Strongest" ? "success" : "primary"}>{m.strength}</Pill>
                      </div>
                      <p className="mt-2 font-bold">{m.title}</p>
                      <p className="mt-1 text-xs text-muted">{m.body}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Votes per voter" hint="Each voter picks up to this many projects. A small budget makes every vote a real choice.">
                  <input type="number" min={1} max={20} value={votes} disabled={data.locked} onChange={(e) => setVotes(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className={inputClass} />
                </Field>
                {mode !== "invite" && (
                  <Field label="Only these email domains (optional)" hint="Comma-separated, e.g. company.com. Subdomains count. Empty = anyone.">
                    <input value={domains} disabled={data.locked} onChange={(e) => setDomains(e.target.value)} placeholder="company.com, partner.org" className={inputClass} />
                  </Field>
                )}
              </div>
            </>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save settings"}
            </Button>
            {notice && (notice.ok ? <SuccessText>{notice.text}</SuccessText> : <ErrorText>{notice.text}</ErrorText>)}
          </div>
        </div>
      </Card>

      {(mode === "invite" || data.invites.length > 0) && <InviteCodes slug={slug} data={data} />}
    </div>
  );
}

function InviteCodes({ slug, data }: { slug: string; data: VotingAdmin }) {
  const router = useRouter();
  const [count, setCount] = useState(50);
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<{ label: string; codes: Array<{ code: string; url: string }> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function download() {
    if (!fresh) return;
    const origin = window.location.origin;
    const rows = ["code,link", ...fresh.codes.map((c) => `${c.code},${origin}${c.url}`)].join("\r\n");
    const url = URL.createObjectURL(new Blob([rows + "\r\n"], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${slug}-ballot-codes-${fresh.label.replace(/\W+/g, "-")}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card title="Ballot codes" description="Single use. Codes are shown only once.">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          const r = await send<{ label: string; codes: Array<{ code: string; url: string }> }>("POST", `/api/events/${slug}/voting/invites`, { count, label });
          setPending(false);
          if (!r.ok) return setError(r.message);
          setError(null);
          setFresh(r.data);
          setLabel("");
          router.refresh();
        }}
      >
        <label className="text-sm font-semibold">
          How many
          <input type="number" min={1} max={1000} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} className={`${inputClass} w-28`} />
        </label>
        <label className="min-w-48 flex-1 text-sm font-semibold">
          Batch name
          <input value={label} onChange={(e) => setLabel(e.target.value)} required placeholder="Venue badges" className={inputClass} />
        </label>
        <Button type="submit" disabled={pending}>
          <KeyRound className="size-4" /> {pending ? "Creating…" : "Create codes"}
        </Button>
      </form>
      {error && (
        <div className="mt-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}

      {fresh && (
        <div className="mt-5 rounded-xl border border-warn/40 bg-warn-soft p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-ink">
              {fresh.codes.length} codes for &ldquo;{fresh.label}&rdquo;. Save them now; they won&apos;t be shown again.
            </p>
            <Button size="sm" variant="secondary" onClick={download}>
              <Download className="size-4" /> Download CSV
            </Button>
          </div>
          <textarea readOnly rows={5} value={fresh.codes.map((c) => c.code).join("\n")} className={`${inputClass} font-mono text-xs`} />
        </div>
      )}

      {data.invites.length > 0 && (
        <ul className="mt-5 divide-y divide-line text-sm">
          {data.invites.map((b) => (
            <li key={b.label} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
              <Ticket className="size-4 text-muted" />
              <span className="font-semibold">{b.label}</span>
              <span className="text-muted">
                {b.redeemed} of {b.total} used{b.revoked ? ` · ${b.revoked} revoked` : ""}
              </span>
              <span className="ml-auto text-xs text-muted">{formatDate(b.createdAt)}</span>
              {b.total - b.redeemed - b.revoked > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const r = await send("POST", `/api/events/${slug}/voting/invites/revoke`, { label: b.label });
                    if (!r.ok) return setError(r.message);
                    router.refresh();
                  }}
                >
                  Revoke unused
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
