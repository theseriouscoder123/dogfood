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
        <p className="max-w-3xl text-sm text-muted">For judges and participants. Anyone can verify them.</p>
      </div>
      <CertificatesManager slug={slug} data={data} />
    </div>
  );
}
