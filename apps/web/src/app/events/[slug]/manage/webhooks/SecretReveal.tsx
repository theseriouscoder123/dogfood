"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui";

export function SecretReveal({ title, secret, note, action, onDone }: { title: string; secret: string; note: string; action?: { label: string; href: string }; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <section role="status" className="rounded-2xl border border-success/30 bg-success-soft p-5 shadow-card sm:p-6">
      <h2 className="flex items-center gap-2 text-[17px] font-bold text-success">
        <Check className="size-5" /> {title}
      </h2>
      <p className="mt-1 text-sm text-ink-2">{note}</p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <code className="min-w-0 flex-1 break-all rounded-lg border border-line bg-surface px-3 py-2.5 font-mono text-sm">{secret}</code>
        <Button
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(secret);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {action && (
          <Link href={action.href} className="inline-flex h-8 items-center gap-1.5 rounded-[10px] bg-primary px-3 text-[13px] font-semibold text-primary-ink hover:bg-primary-hover">
            {action.label} <ArrowRight className="size-3.5" />
          </Link>
        )}
        <Button variant="ghost" size="sm" onClick={onDone}>
          I&apos;ve saved it
        </Button>
      </div>
    </section>
  );
}
