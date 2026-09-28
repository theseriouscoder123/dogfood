import Link from "next/link";
import { Award, ExternalLink, FileText, Gavel, Medal } from "lucide-react";
import { api } from "@/lib/api";
import type { RecordSummary } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { ordinal } from "@/lib/records";
import { EmptyState, Pill } from "@/components/ui";
import { LogoTile } from "@/components/visuals";

export const metadata = { title: "My certificates" };

export default async function MyRecordsPage() {
  const { records } = await api<{ records: Array<RecordSummary & { event: NonNullable<RecordSummary["event"]> }> }>("/api/records/mine");

  return (
    <>
      <div>
        <h1 className="text-3xl font-extrabold">Certificates</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted">Signed records of your hackathons. Anyone with the link can verify them.</p>
      </div>
      {records.length === 0 ? (
        <EmptyState icon={<Award className="size-5" />} title="Nothing yet">
          Organizers issue certificates after judging closes. You&apos;ll find them here.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {records.map((r) => (
            <li key={r.id} className="flex flex-col rounded-2xl border border-line bg-surface p-5 shadow-card">
              <div className="flex items-start gap-3">
                <LogoTile seed={r.event.slug} src={r.event.logoUrl} name={r.event.name} className="size-11 shrink-0 text-sm" />
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
                    {r.type === "judge_participation" ? <Gavel className="size-3.5" /> : <Award className="size-3.5" />}
                    {r.type === "judge_participation" ? "Judge" : "Participant"}
                  </p>
                  <h2 className="truncate font-bold">{r.event.name}</h2>
                  <p className="text-xs text-muted">Issued {formatDate(r.issuedAt)}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-1 flex-wrap content-start gap-2 text-sm">
                {r.status === "revoked" && <Pill tone="danger">revoked</Pill>}
                {r.claims.project && <Pill>{r.claims.project.title}</Pill>}
                {r.claims.placement && (
                  <Pill tone="accent">
                    <Medal className="size-3.5" /> {ordinal(r.claims.placement.rank)} of {r.claims.placement.of}
                  </Pill>
                )}
                {r.claims.reviewsSubmitted !== undefined && <Pill>{r.claims.reviewsSubmitted} review{r.claims.reviewsSubmitted === 1 ? "" : "s"}</Pill>}
              </div>
              <div className="mt-4 flex gap-2">
                <Link href={`/certificates/${r.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-[10px] bg-primary px-3 text-[13px] font-semibold text-primary-ink hover:bg-primary-hover">
                  <FileText className="size-3.5" /> Certificate
                </Link>
                <Link href={`/verify/${r.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-line px-3 text-[13px] font-semibold hover:bg-surface-2">
                  <ExternalLink className="size-3.5" /> Verification link
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
