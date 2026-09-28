import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { PublicRecord, RecordStatement } from "@/lib/types";
import { ordinal, recordTitle } from "@/lib/records";
import { LogoMark, LogoTile } from "@/components/visuals";
import { PrintButton } from "./PrintButton";

export const metadata = { title: "Certificate" };

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(iso));

/** A printable certificate (A4 landscape; "Save as PDF" from the print dialog). The QR code opens its verification page. */
export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await api<PublicRecord>(`/api/records/${encodeURIComponent(id)}`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const s = JSON.parse(r.signedText) as RecordStatement;
  const judge = s.type === "judge_participation";
  const qr = await QRCode.toString(s.verify, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#141a33", light: "#0000" } });
  const void_ = r.status !== "current";

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-6 sm:px-6 print:m-0 print:max-w-none print:p-0">
      <style>{`@page { size: A4 landscape; margin: 0 } @media print { body > header, body > footer { display: none !important } body { background: white !important } }`}</style>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/verify/${s.id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
          <ArrowLeft className="size-4" /> Verification details
        </Link>
        <PrintButton />
      </div>

      {/* Fixed colours: a certificate looks the same in dark mode and on paper. */}
      <article className="relative mx-auto aspect-[297/210] w-full [container-type:inline-size] overflow-hidden rounded-2xl bg-[#fbfaf6] text-[#141a33] shadow-lift print:aspect-auto print:h-[210mm] print:w-[297mm] print:rounded-none print:shadow-none">
        <div className="absolute inset-[2.2%] rounded-xl border-2 border-[#c9a54a]/70" />
        <div className="absolute inset-[3.2%] rounded-lg border border-[#c9a54a]/40" />
        {void_ && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="-rotate-12 rounded-xl border-8 border-[#b91c1c]/60 px-10 py-4 text-[5cqw] font-black uppercase tracking-widest text-[#b91c1c]/60">
              {r.status === "revoked" ? "Revoked" : "Superseded"}
            </span>
          </div>
        )}

        <div className="relative flex h-full flex-col px-[8%] py-[6.5%]">
          <div className="flex items-center justify-between">
            <LogoTile seed={s.event.slug} src={r.event.logoUrl} name={s.event.name} className="size-[7cqw] text-[2cqw]" />
            <p className="text-right text-[1.3cqw] font-semibold uppercase tracking-[0.3em] text-[#6b6f85]">{s.event.name}</p>
          </div>

          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <p className="text-[1.4cqw] font-bold uppercase tracking-[0.35em] text-[#a8862f]">{recordTitle(s)}</p>
            <p className="mt-[2cqw] text-[1.6cqw] text-[#4a4f66]">This certifies that</p>
            <h1 className="mt-[0.6cqw] font-display text-[5.2cqw] font-extrabold leading-tight">{s.subject.name}</h1>
            <div className="mx-auto mt-[0.8cqw] h-px w-[40%] bg-[#c9a54a]/70" />
            <p className="mt-[1.6cqw] max-w-[70%] text-[1.7cqw] leading-relaxed text-[#2c3150]">
              {judge ? (
                <>
                  served on the judging panel of <b>{s.event.name}</b>, reviewing {s.claims.projectsReviewed} project{s.claims.projectsReviewed === 1 ? "" : "s"} with{" "}
                  {s.claims.reviewsSubmitted} submitted review{s.claims.reviewsSubmitted === 1 ? "" : "s"}.
                </>
              ) : (
                <>
                  took part in <b>{s.event.name}</b> as a member of team <b>{s.claims.team}</b>, building <b>{s.claims.project?.title}</b>.
                </>
              )}
            </p>
            {(s.claims.placement || s.claims.peoplesChoice) && (
              <div className="mt-[1.6cqw] flex flex-wrap justify-center gap-[1cqw]">
                {s.claims.placement && (
                  <span className="rounded-full bg-[#141a33] px-[1.6cqw] py-[0.5cqw] text-[1.3cqw] font-bold text-[#f5d27a]">
                    {ordinal(s.claims.placement.rank)} of {s.claims.placement.of} · judged results
                  </span>
                )}
                {s.claims.peoplesChoice && (
                  <span className="rounded-full border-2 border-[#141a33] px-[1.6cqw] py-[0.5cqw] text-[1.3cqw] font-bold">{ordinal(s.claims.peoplesChoice.rank)} · People&apos;s Choice</span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-end justify-between gap-[3cqw]">
            <div className="text-[1.1cqw] text-[#4a4f66]">
              <p>
                {day(s.event.startedAt)} to {day(s.event.endedAt)}
              </p>
              <p className="mt-[0.3cqw]">Issued {day(s.issuedAt)}</p>
            </div>
            <div className="flex items-end gap-[1.4cqw]">
              <div className="text-right text-[0.95cqw] leading-snug text-[#4a4f66]">
                <p className="flex items-center justify-end gap-[0.4cqw] font-bold text-[#141a33]">
                  <ShieldCheck className="size-[1.3cqw]" /> Digitally signed
                </p>
                <p>Ed25519 key {s.kid}</p>
                <p className="max-w-[26cqw] break-all font-mono">{s.verify}</p>
                <p className="mt-[0.4cqw] flex items-center justify-end gap-[0.4cqw]">
                  <LogoMark size={14} /> Dogfood
                </p>
              </div>
              <div className="size-[8cqw] shrink-0" dangerouslySetInnerHTML={{ __html: qr }} />
            </div>
          </div>
        </div>
      </article>
      <p className="mt-3 text-center text-xs text-muted print:hidden">Scan the code, or open the link, to check this certificate is genuine and hasn&apos;t been revoked.</p>
    </div>
  );
}
