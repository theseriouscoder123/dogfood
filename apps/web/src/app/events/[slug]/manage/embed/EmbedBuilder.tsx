"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, Card, Field, inputClass } from "@/components/ui";

type Props = { slug: string; tracks: Array<{ id: string; name: string }>; resultsPublished: boolean };

export function EmbedBuilder({ slug, tracks, resultsPublished }: Props) {
  const [origin, setOrigin] = useState("http://localhost:8080");
  const [theme, setTheme] = useState<"auto" | "light" | "dark">("auto");
  const [track, setTrack] = useState("");
  const [search, setSearch] = useState(true);
  const [winners, setWinners] = useState(true);
  const [kind, setKind] = useState<"script" | "iframe">("script");
  useEffect(() => setOrigin(window.location.origin), []);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (theme !== "auto") p.set("theme", theme);
    if (track) p.set("track", track);
    if (!search) p.set("search", "0");
    if (!winners) p.set("winners", "0");
    return p.toString();
  }, [theme, track, search, winners]);

  const snippet =
    kind === "script"
      ? `<script src="${origin}/embed.js" data-event="${slug}"${theme !== "auto" ? ` data-theme="${theme}"` : ""}${track ? ` data-track="${track}"` : ""}${search ? "" : ' data-search="false"'}${winners ? "" : ' data-winners="false"'} async></script>`
      : `<iframe src="${origin}/embed/${slug}${query ? `?${query}` : ""}" title="Hackathon projects" loading="lazy" style="width:100%;height:720px;border:0;border-radius:16px"></iframe>`;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
      <Card title="Options">
        <div className="space-y-5">
          <Field label="Theme">
            <select className={inputClass} value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)}>
              <option value="auto">Follow the visitor&apos;s system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </Field>
          {tracks.length > 0 && (
            <Field label="Start on a track">
              <select className={inputClass} value={track} onChange={(e) => setTrack(e.target.value)}>
                <option value="">All projects</option>
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={search} onChange={(e) => setSearch(e.target.checked)} /> Search box
          </label>
          <label className="flex items-start gap-2 text-sm font-semibold">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={winners} onChange={(e) => setWinners(e.target.checked)} />
            <span>
              Medal badges for the top three
              <span className="block text-xs font-normal text-muted">{resultsPublished ? "Results are published, so winners show first." : "Appear once results are published."}</span>
            </span>
          </label>
        </div>
      </Card>

      <div className="min-w-0 space-y-6">
        <Card
          title="Code"
          description={kind === "script" ? "Paste it where the gallery should go. It sizes itself to fit." : "For site builders that don't allow scripts. Set the height yourself."}
          actions={
            <div className="flex rounded-lg border border-line p-0.5 text-xs font-semibold">
              {(["script", "iframe"] as const).map((k) => (
                <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-md px-2.5 py-1 ${kind === k ? "bg-ink text-bg" : "text-ink-2"}`}>
                  {k === "script" ? "Script" : "iframe"}
                </button>
              ))}
            </div>
          }
        >
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-ink px-3 py-2.5 font-mono text-xs leading-relaxed text-bg">{snippet}</pre>
          <CopyButton text={snippet} />
        </Card>

        <Card title="Preview" description="Exactly what visitors to your site will see." padded={false}>
          <div className="border-t border-line bg-surface-2 p-3 sm:p-4">
            <iframe key={query} src={`/embed/${slug}${query ? `?${query}` : ""}`} title="Gallery preview" className="h-[640px] w-full rounded-2xl border-0" />
          </div>
        </Card>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      className="mt-3"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy code"}
    </Button>
  );
}
