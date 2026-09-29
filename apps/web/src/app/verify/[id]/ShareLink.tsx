"use client";

import { useState } from "react";
import { Check, Link2 } from "lucide-react";

/** Copies this page's address, for pasting into a CV, LinkedIn or an email. */
export function ShareLink() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard?.writeText(window.location.href).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line bg-surface px-4 text-sm font-semibold hover:border-line-strong hover:bg-surface-2"
    >
      {copied ? <Check className="size-4 text-success" /> : <Link2 className="size-4" />} {copied ? "Link copied" : "Copy link to share"}
    </button>
  );
}
