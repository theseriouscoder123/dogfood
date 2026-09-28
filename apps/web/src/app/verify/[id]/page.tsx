import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Award, Download, FileText, Gavel, History, Medal } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { PublicRecord, RecordStatement } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { attestation, ordinal, recordTitle } from "@/lib/records";
import { Card, Pill } from "@/components/ui";
import { LogoTile } from "@/components/visuals";
import { BrowserCheck } from "./BrowserCheck";

export const metadata = { title: "Verify a record" };

export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await api<PublicRecord>(`/api/records/${encodeURIComponent(id)}`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  // Show what was signed, not a separate copy: parse the exact text the signature covers.
  const s = JSON.parse(r.signedText) as RecordStatement;
  const judge = s.type === "judge_participation";

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 pt-10 sm:px-6">
      <BrowserCheck status={r.status} serverValid={r.signatureValid} publicKeyPem={r.key.publicKeyPem} signedText={r.signedText} signature={r.signature} />

      {r.status === "revoked" && (
        <div className="flex gap-3 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          <AlertTriangle className="size-5 shrink-0" />
          <div>
            <b>Revoked by the organizers on {formatDate(r.revokedAt)}.</b> The signature is genuine, but the issuer no longer stands behind this record.
            {r.revokedReason && <span className="mt-1 block text-ink-2">Reason: {r.revokedReason}</span>}
          </div>
        </div>
      )}
      {r.status === "superseded" && r.supersededById && (
        <div className="flex gap-3 rounded-2xl border border-warn/30 bg-warn-soft p-4 text-sm text-warn">
          <History className="size-5 shrink-0" />
          <div>
            <b>A newer version exists.</b> This one is genuine but out of date (for example, it was issued before results were published).{" "}
            <Link href={`/verify/${r.supersededById}`} className="font-semibold underline">
              See the current record
            </Link>
          </div>
        </div>
      )}

      <Card>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <LogoTile seed={s.event.slug} src={r.event.logoUrl} name={s.event.name} className="size-16 shrink-0 text-lg" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-primary">
              {judge ? <Gavel className="size-3.5" /> : <Award className="size-3.5" />} {recordTitle(s)}
            </p>
            <h1 className="mt-1 text-3xl font-extrabold">{s.subject.name}</h1>
            <p className="mt-2 text-[15px] text-ink-2">{attestation(s)}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {s.claims.placement && (
                <Pill tone="accent">
                  <Medal className="size-3.5" /> {ordinal(s.claims.placement.rank)} of {s.claims.placement.of} in the judged results
                </Pill>
              )}
              {s.claims.peoplesChoice && (
                <Pill tone="primary">
                  {ordinal(s.claims.peoplesChoice.rank)} in People&apos;s Choice ({s.claims.peoplesChoice.votes} votes)
                </Pill>
              )}
              {s.claims.project?.track && <Pill>{s.claims.project.track}</Pill>}
              {judge && s.claims.tracks?.map((t) => <Pill key={t}>{t}</Pill>)}
            </div>
          </div>
        </div>

        <dl className="mt-6 grid gap-x-8 gap-y-3 border-t border-line pt-5 text-sm sm:grid-cols-2">
          <Fact label="Event">
            <Link href={`/events/${s.event.slug}`} className="font-semibold hover:text-primary">
              {s.event.name}
            </Link>{" "}
            <span className="text-muted">
              · {formatDate(s.event.startedAt).replace(/,.*$/, "")} to {formatDate(s.event.endedAt).replace(/,.*$/, "")}
            </span>
          </Fact>
          <Fact label="Issued">
            {formatDate(s.issuedAt)} by {s.issuer.name} <span className="text-muted">({s.issuer.url})</span>
          </Fact>
          {s.claims.project && (
            <Fact label="Project">
              <a href={s.claims.project.url} className="font-semibold hover:text-primary">
                {s.claims.project.title}
              </a>
            </Fact>
          )}
          {judge && (
            <Fact label="Reviews commitment">
              <code className="break-all font-mono text-xs">{s.claims.reviewsDigest}</code>
              <span className="mt-0.5 block text-xs text-muted">A SHA-256 over this judge&apos;s exact reviews and scores. It proves which reviews the record covers without revealing them.</span>
            </Fact>
          )}
          <Fact label="Signing key">
            <code className="font-mono text-xs">Ed25519 · {r.key.kid}</code>
            {r.key.retiredAt && <span className="ml-1 text-xs text-muted">(retired {formatDate(r.key.retiredAt)}; still valid for records it signed)</span>}
          </Fact>
          <Fact label="Record id">
            <code className="break-all font-mono text-xs">{s.id}</code>
          </Fact>
        </dl>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={`/certificates/${s.id}`} className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-primary px-4 text-sm font-semibold text-primary-ink hover:bg-primary-hover">
            <FileText className="size-4" /> View certificate
          </Link>
          <a href={`/api/records/${s.id}/signed.json`} download className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line bg-surface px-4 text-sm font-semibold hover:border-line-strong hover:bg-surface-2">
            <Download className="size-4" /> Signed record (.json)
          </a>
        </div>
      </Card>

      <Card title="Check it yourself" description="Don't take this page's word for it. The signature can be checked with nothing but the public key.">
        <ol className="space-y-4 text-sm">
          <li>
            <p className="font-semibold">With the verifier in the Dogfood repository (Node 18+, no packages)</p>
            <pre className="mt-1 overflow-x-auto rounded-lg bg-ink px-3 py-2.5 font-mono text-xs text-bg">{`node tools/verify-record.mjs ${s.verify}`}</pre>
          </li>
          <li>
            <p className="font-semibold">With OpenSSL 3</p>
            <pre className="mt-1 overflow-x-auto rounded-lg bg-ink px-3 py-2.5 font-mono text-xs text-bg">{`node tools/verify-record.mjs ${s.verify} --openssl out
openssl pkeyutl -verify -pubin -inkey out/key.pem -rawin -in out/statement.txt -sigfile out/signature.bin`}</pre>
          </li>
          <li>
            <p className="font-semibold">By hand</p>
            <p className="text-ink-2">
              The signature is Ed25519 over the UTF-8 bytes of the statement as canonical JSON (keys sorted, no spaces). The public keys are at{" "}
              <a href="/api/records/keys" className="font-mono text-xs text-primary hover:underline">
                /api/records/keys
              </a>
              .
            </p>
          </li>
        </ol>
        <details className="mt-5 rounded-xl border border-line">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold">The exact signed text and signature</summary>
          <div className="space-y-3 border-t border-line p-4">
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface-2 p-3 font-mono text-xs">{r.signedText}</pre>
            <p className="break-all font-mono text-xs">
              <b className="font-sans">signature</b> {r.signature}
            </p>
            <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-xs">{r.key.publicKeyPem}</pre>
          </div>
        </details>
      </Card>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
