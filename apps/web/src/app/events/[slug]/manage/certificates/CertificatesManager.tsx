"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Award, Ban, FileText, Gavel, Lock, PenLine, ShieldCheck } from "lucide-react";
import { send } from "@/lib/client";
import type { RecordsAdmin, RecordSummary } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { ordinal } from "@/lib/records";
import { Button, Card, EmptyState, ErrorText, Pill, SuccessText } from "@/components/ui";

const STATUS_TONE = { current: "success", superseded: "neutral", revoked: "danger" } as const;

export function CertificatesManager({ slug, data }: { slug: string; data: RecordsAdmin }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [showOld, setShowOld] = useState(false);
  const shown = useMemo(() => data.records.filter((r) => showOld || r.status !== "superseded"), [data.records, showOld]);
  const current = data.records.filter((r) => r.status === "current");

  async function issue() {
    setPending(true);
    setNotice(null);
    const r = await send<{ issued: number; superseded: number; unchanged: number }>("POST", `/api/events/${slug}/records/issue`);
    setPending(false);
    if (!r.ok) return setNotice({ ok: false, text: r.message });
    const { issued, superseded, unchanged } = r.data;
    setNotice({
      ok: true,
      text: issued === 0 ? `Everything is up to date (${unchanged} records unchanged).` : `Signed ${issued} record${issued === 1 ? "" : "s"}${superseded ? `, replacing ${superseded} whose facts changed` : ""}. ${unchanged} unchanged.`,
    });
    router.refresh();
  }

  async function revoke(r: RecordSummary) {
    const reason = prompt(`Revoke ${r.subject.name}'s record? Anyone checking it will see it's revoked, with your reason. This can't be undone.\n\nReason:`);
    if (!reason) return;
    const res = await send("POST", `/api/events/${slug}/records/${r.id}/revoke`, { reason });
    setNotice(res.ok ? { ok: true, text: `Revoked ${r.subject.name}'s record.` } : { ok: false, text: res.message });
    router.refresh();
  }

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-5">
          <div className={`grid size-12 place-items-center rounded-2xl ${data.issuable ? "bg-primary-soft text-primary" : "bg-surface-2 text-muted"}`}>
            {data.issuable ? <PenLine className="size-5" /> : <Lock className="size-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold">
              {!data.issuable ? "Available once judging closes" : current.length === 0 ? "Ready to issue" : `${current.length} current records`}
            </p>
            <p className="text-sm text-muted">
              {!data.issuable
                ? `Judging closes ${formatDate(data.judgingClosesAt)}. Records describe the final picture, so they wait until then.`
                : data.resultsPublished
                  ? "Results are published, so certificates include each team's placement."
                  : "Results aren't published yet. Issue now, and issue again after publishing to add placements (the old records are marked superseded)."}
            </p>
          </div>
          <Button onClick={issue} disabled={!data.issuable || pending}>
            <ShieldCheck className="size-4" /> {pending ? "Signing…" : current.length ? "Re-issue changed records" : "Issue records"}
          </Button>
        </div>
        {notice && <div className="mt-4">{notice.ok ? <SuccessText>{notice.text}</SuccessText> : <ErrorText>{notice.text}</ErrorText>}</div>}
      </Card>

      {data.records.length === 0 ? (
        <EmptyState icon={<Award className="size-5" />} title="No records yet">
          Once issued, every judge and participant finds theirs under “My certificates”, with a link they can share.
        </EmptyState>
      ) : (
        <Card
          title="Issued"
          description={`${current.filter((r) => r.type === "judge_participation").length} judges · ${current.filter((r) => r.type === "participation").length} participants`}
          padded={false}
          actions={
            <label className="flex items-center gap-2 text-xs font-semibold text-muted">
              <input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} className="size-4 accent-[var(--primary)]" /> show superseded
            </label>
          }
        >
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-surface-2 text-xs font-bold uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-5 py-2.5 sm:px-6">Person</th>
                  <th className="px-3 py-2.5">Record</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Issued</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((r) => (
                  <tr key={r.id} className={r.status === "current" ? "" : "opacity-70"}>
                    <td className="px-5 py-3 sm:px-6">
                      <div className="font-semibold">{r.subject.name}</div>
                      <div className="text-xs text-muted">{r.subject.email}</div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        {r.type === "judge_participation" ? <Gavel className="size-4 text-muted" /> : <Award className="size-4 text-muted" />}
                        {r.type === "judge_participation" ? `Judge · ${r.claims.reviewsSubmitted} review${r.claims.reviewsSubmitted === 1 ? "" : "s"}` : r.claims.project?.title}
                      </span>
                      {r.claims.placement && <span className="ml-2 text-xs font-semibold text-accent">{ordinal(r.claims.placement.rank)}</span>}
                    </td>
                    <td className="px-3 py-3">
                      <Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill>
                      {r.revokedReason && <div className="mt-1 max-w-48 text-xs text-muted">{r.revokedReason}</div>}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted">{formatDate(r.issuedAt)}</td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-1.5">
                        <Link href={`/certificates/${r.id}`} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-ink-2 hover:bg-surface-2" title="Certificate">
                          <FileText className="size-3.5" /> View
                        </Link>
                        {r.status === "current" && (
                          <Button size="sm" variant="ghost" className="text-danger" onClick={() => revoke(r)}>
                            <Ban className="size-3.5" /> Revoke
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
