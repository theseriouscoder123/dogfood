"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AtSign, Ban, CheckCircle2, Clock, Copy, EyeOff, Network, RotateCcw, ShieldAlert, ShieldCheck, TrendingUp, UserPlus } from "lucide-react";
import { send } from "@/lib/client";
import type { VoteIncident, VoteReview, VoteSignalType } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { Button, Card, EmptyState, ErrorText, inputClass, Pill } from "@/components/ui";

const SIGNAL: Record<VoteSignalType, { label: string; icon: typeof Network }> = {
  shared_network: { label: "Same network", icon: Network },
  identical_ballots: { label: "Identical ballots", icon: Copy },
  fresh_accounts: { label: "Brand-new accounts", icon: UserPlus },
  address_pattern: { label: "Numbered addresses", icon: AtSign },
  surge: { label: "Sudden surge", icon: TrendingUp },
  blind_votes: { label: "Voted without looking", icon: EyeOff },
};
const SEVERITY = {
  high: { label: "High", tone: "danger", why: "3 or more independent signals agree" },
  medium: { label: "Medium", tone: "warn", why: "2 independent signals agree" },
  low: { label: "Low", tone: "neutral", why: "a single signal; often innocent" },
} as const;

const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(iso));

export function VoteReviewBoard({ slug, data }: { slug: string; data: VoteReview }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const s = data.summary;

  async function post(path: string, body: object) {
    setBusy(true);
    const r = await send("POST", `/api/events/${slug}/voting/review/${path}`, body);
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return false;
    }
    setError(null);
    router.refresh();
    return true;
  }

  if (data.window === "off") return <EmptyState icon={<ShieldCheck className="size-5" />} title="No community vote">Turn on community voting first; its ballots are reviewed here.</EmptyState>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Ballots cast", value: s.ballots, sub: "with at least one pick" },
          { label: "Open incidents", value: s.open, sub: `${s.incidents} found in total`, warn: s.open > 0 },
          { label: "Quarantined", value: s.quarantined, sub: "kept, but not counted" },
          { label: "Voting", value: data.window === "open" ? "Open" : data.window === "closed" ? "Closed" : "Scheduled", sub: "review before publishing" },
        ].map((x) => (
          <div key={x.label} className={`rounded-2xl border bg-surface p-4 shadow-card ${x.warn ? "border-warn/40" : "border-line"}`}>
            <div className={`font-display text-2xl font-extrabold tabular-nums ${x.warn ? "text-warn" : ""}`}>{x.value}</div>
            <div className="text-sm font-semibold text-ink-2">{x.label}</div>
            <div className="mt-0.5 text-xs text-muted">{x.sub}</div>
          </div>
        ))}
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {data.incidents.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="size-5" />} title="Nothing suspicious so far">
          Checks run over every ballot each time you open this page: shared networks, identical bursts, brand-new accounts, numbered addresses, sudden surges and votes cast
          without opening the project.
        </EmptyState>
      ) : (
        <ul className="space-y-4">
          {data.incidents.map((i) => (
            <IncidentCard key={i.key} incident={i} busy={busy} post={post} />
          ))}
        </ul>
      )}

      {data.quarantinedBallots.length > 0 && <Quarantined data={data} busy={busy} post={post} />}
    </div>
  );
}

function IncidentCard({ incident: i, busy, post }: { incident: VoteIncident; busy: boolean; post: (path: string, body: object) => Promise<boolean> }) {
  const [mode, setMode] = useState<"quarantine" | "dismiss" | null>(null);
  const [text, setText] = useState("");
  const sev = SEVERITY[i.severity];
  const remaining = i.ballotIds.length - i.quarantined;
  const settled = remaining === 0 || i.resolution;

  return (
    <li className={`rounded-2xl border bg-surface p-5 shadow-card ${i.severity === "high" && !settled ? "border-danger/40" : "border-line"} ${settled ? "opacity-80" : ""}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className={`grid size-10 shrink-0 place-items-center rounded-xl ${i.severity === "high" ? "bg-danger-soft text-danger" : i.severity === "medium" ? "bg-warn-soft text-warn" : "bg-surface-2 text-ink-2"}`}>
          <ShieldAlert className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={sev.tone}>{sev.label}</Pill>
            <h3 className="font-bold">
              {i.ballotIds.length} ballots{i.projects.length > 0 && <> backing {i.projects.map((p) => p.title).join(", ")}</>}
            </h3>
            {i.quarantined > 0 && <Pill tone="danger">{i.quarantined === i.ballotIds.length ? "all quarantined" : `${i.quarantined} quarantined`}</Pill>}
            {i.resolution && <Pill tone="success">looks fine</Pill>}
          </div>
          <p className="mt-0.5 text-xs text-muted">Severity {sev.label.toLowerCase()}: {sev.why}.</p>

          <ul className="mt-3 space-y-1.5">
            {i.signals.map((sg, n) => {
              const S = SIGNAL[sg.type];
              return (
                <li key={n} className="flex items-start gap-2 text-sm">
                  <S.icon className="mt-0.5 size-4 shrink-0 text-muted" />
                  <span>
                    <b>{S.label}.</b> <span className="text-ink-2">{sg.summary}</span>
                  </span>
                </li>
              );
            })}
          </ul>

          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-semibold text-primary">Show {Math.min(12, i.sample.length)} of the ballots</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[520px] text-xs">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="py-1.5 pr-3 font-semibold">Voter</th>
                    <th className="py-1.5 pr-3 font-semibold">Network</th>
                    <th className="py-1.5 pr-3 font-semibold">Cast (UTC)</th>
                    <th className="py-1.5 pr-3 font-semibold">Account age at vote</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {i.sample.map((b) => (
                    <tr key={b.ballotId} className={b.quarantined ? "text-muted line-through" : ""}>
                      <td className="py-1.5 pr-3 font-mono">{b.voter}</td>
                      <td className="py-1.5 pr-3 font-mono">{b.network ?? "–"}</td>
                      <td className="py-1.5 pr-3">{time(b.castAt)}</td>
                      <td className="py-1.5 pr-3">{b.accountAgeMinutes === null ? "–" : b.accountAgeMinutes < 60 ? `${b.accountAgeMinutes} min` : `${Math.round(b.accountAgeMinutes / 1440)} days`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          {i.resolution && (
            <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-sm">
              <p className="text-ink-2">{i.resolution.note}</p>
              <p className="text-xs text-muted">
                {i.resolution.by ?? "Someone"} · {formatDate(i.resolution.at)}
              </p>
            </div>
          )}

          {mode && (
            <div className="mt-3">
              <textarea
                autoFocus
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={mode === "quarantine" ? "Why these ballots shouldn't count (kept in the audit log)" : "Why this is fine (e.g. a class voting together from campus)"}
                className={inputClass}
              />
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant={mode === "quarantine" ? "danger" : "primary"}
                  disabled={busy || text.trim().length < (mode === "quarantine" ? 5 : 3)}
                  onClick={async () => {
                    const ok =
                      mode === "quarantine"
                        ? await post("quarantine", { ballotIds: i.ballotIds, reason: text.trim(), incidentKey: i.key })
                        : await post("resolve", { incidentKey: i.key, status: "dismissed", note: text.trim() });
                    if (ok) {
                      setMode(null);
                      setText("");
                    }
                  }}
                >
                  {mode === "quarantine" ? `Quarantine ${remaining} ballot${remaining === 1 ? "" : "s"}` : "Mark as fine"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setMode(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        {!mode && (
          <div className="flex flex-wrap gap-1.5">
            {i.resolution ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => post("resolve", { incidentKey: i.key, status: "open" })}>
                <RotateCcw className="size-4" /> Reopen
              </Button>
            ) : remaining > 0 ? (
              <>
                <Button size="sm" variant="danger" onClick={() => setMode("quarantine")}>
                  <Ban className="size-4" /> Quarantine
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setMode("dismiss")}>
                  <CheckCircle2 className="size-4" /> Looks fine
                </Button>
              </>
            ) : null}
          </div>
        )}
      </div>
    </li>
  );
}

function Quarantined({ data, busy, post }: { data: VoteReview; busy: boolean; post: (path: string, body: object) => Promise<boolean> }) {
  const [restoring, setRestoring] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  return (
    <Card title="Quarantined ballots" description="Kept in full and left out of the count. Restoring one needs a reason, like quarantining did." padded={false}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wider text-muted">
              <th className="py-2.5 pl-5 pr-3 sm:pl-6">Voter</th>
              <th className="py-2.5 pr-3">Cast</th>
              <th className="py-2.5 pr-3">Reason</th>
              <th className="py-2.5 pr-5 sm:pr-6" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.quarantinedBallots.map((b) => (
              <tr key={b.ballotId}>
                <td className="py-2.5 pl-5 pr-3 font-mono text-xs sm:pl-6">{b.voter}</td>
                <td className="py-2.5 pr-3 text-xs text-muted">
                  <Clock className="mr-1 inline size-3.5" />
                  {time(b.castAt)}
                </td>
                <td className="py-2.5 pr-3 text-xs text-ink-2">{b.reason}</td>
                <td className="py-2.5 pr-5 text-right sm:pr-6">
                  {restoring === b.ballotId ? (
                    <div className="flex items-center justify-end gap-2">
                      <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why restore?" className={`${inputClass} mt-0 h-8 w-48 py-1 text-xs`} />
                      <Button
                        size="sm"
                        disabled={busy || reason.trim().length < 5}
                        onClick={async () => {
                          if (await post("restore", { ballotIds: [b.ballotId], reason: reason.trim() })) {
                            setRestoring(null);
                            setReason("");
                          }
                        }}
                      >
                        Restore
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setRestoring(b.ballotId)}>
                      <RotateCcw className="size-4" /> Restore
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
