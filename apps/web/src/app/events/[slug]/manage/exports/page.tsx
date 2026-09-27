import { Download, FileSpreadsheet, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import type { ExportItem } from "@/lib/types";
import { buttonClass, Card } from "@/components/ui";

export const metadata = { title: "Exports" };

const STAGES = ["Registration", "Submissions", "Judging", "Results", "Community", "Record"];

export default async function ExportsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { exports } = await api<{ exports: ExportItem[] }>(`/api/events/${encodeURIComponent(slug)}/export`);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-3xl font-extrabold">Exports</h1>
        <p className="text-sm text-muted">Your data, as CSV, at every stage. Open them in any spreadsheet or feed them to your own analysis.</p>
      </div>

      {STAGES.map((stage) => {
        const items = exports.filter((x) => x.stage === stage);
        if (!items.length) return null;
        return (
          <section key={stage}>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted">{stage}</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {items.map((x) => (
                <div key={x.file} className="flex flex-col rounded-2xl border border-line bg-surface p-5 shadow-card">
                  <div className="flex items-start gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-success-soft text-success">
                      <FileSpreadsheet className="size-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold">{x.title}</h3>
                      <p className="font-mono text-xs text-muted">{x.file}</p>
                    </div>
                  </div>
                  <p className="mt-3 flex-1 text-sm text-ink-2">{x.description}</p>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-muted">
                      {x.rows.toLocaleString()} row{x.rows === 1 ? "" : "s"} · {x.columns} columns
                    </span>
                    <a href={x.url} download className={buttonClass("secondary", "sm")}>
                      <Download className="size-4" /> Download
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <Card>
        <p className="flex items-start gap-3 text-sm text-muted">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" />
          <span>
            Files are UTF-8 with a header row. Cells that start with <code className="font-mono">=</code>, <code className="font-mono">+</code>,{" "}
            <code className="font-mono">-</code> or <code className="font-mono">@</code> get a leading apostrophe so a spreadsheet never runs them as formulas. Every
            download is recorded in the audit log.
          </span>
        </p>
      </Card>
    </div>
  );
}
