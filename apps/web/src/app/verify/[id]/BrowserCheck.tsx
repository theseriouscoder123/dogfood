"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { verifyInBrowser } from "@/lib/records";
import type { PublicRecord } from "@/lib/types";

type Props = { status: PublicRecord["status"]; serverValid: boolean; publicKeyPem: string; signedText: string; signature: string };

/** The headline verdict. The signature is re-checked here, in the visitor's browser, rather than taken on trust from the server. */
export function BrowserCheck({ status, serverValid, publicKeyPem, signedText, signature }: Props) {
  const [local, setLocal] = useState<boolean | null | "checking">("checking");
  useEffect(() => {
    void verifyInBrowser(publicKeyPem, signedText, signature).then(setLocal);
  }, [publicKeyPem, signedText, signature]);

  const valid = local === "checking" || local === null ? serverValid : local;
  const tone = !valid ? "danger" : status === "current" ? "success" : "warn";
  const styles = { success: "border-success/30 bg-success-soft text-success", warn: "border-warn/30 bg-warn-soft text-warn", danger: "border-danger/30 bg-danger-soft text-danger" }[tone];
  const Icon = !valid ? ShieldAlert : ShieldCheck;

  return (
    <div className={`flex flex-col gap-3 rounded-2xl border p-5 sm:flex-row sm:items-center ${styles}`}>
      <Icon className="size-9 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-lg font-extrabold">
          {!valid ? "Signature invalid: do not trust this record" : status === "current" ? "Authentic and current" : status === "revoked" ? "Authentic, but revoked" : "Authentic, but superseded"}
        </p>
        <p className="text-sm text-ink-2">
          {valid ? "Signed by the Dogfood portal with its Ed25519 key. Nothing in it has changed since." : "The statement doesn't match its signature: it was altered, or signed by someone else."}
        </p>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-current/20 bg-surface px-3 py-1 text-xs font-semibold">
        {local === "checking" ? (
          <>
            <Loader2 className="size-3.5 animate-spin" /> checking in your browser…
          </>
        ) : local === null ? (
          "checked by the server (your browser lacks Ed25519)"
        ) : (
          <>
            <BadgeCheck className="size-3.5" /> {local ? "verified in your browser" : "failed in your browser"}
          </>
        )}
      </span>
    </div>
  );
}
