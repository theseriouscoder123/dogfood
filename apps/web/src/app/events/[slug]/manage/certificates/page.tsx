import { api } from "@/lib/api";
import type { RecordsAdmin } from "@/lib/types";
import { CertificatesManager } from "./CertificatesManager";

export const metadata = { title: "Certificates" };

export default async function CertificatesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await api<RecordsAdmin>(`/api/events/${encodeURIComponent(slug)}/records`);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-3xl font-extrabold">Certificates &amp; records</h1>
        <p className="max-w-3xl text-sm text-muted">
          Signed, publicly verifiable records: one for every judge who submitted a review, and a certificate for every member of a submitted project. Each carries an Ed25519
          signature and a QR link that anyone can check, so a certificate can&apos;t be forged or quietly edited.
        </p>
      </div>
      <CertificatesManager slug={slug} data={data} />
    </div>
  );
}
