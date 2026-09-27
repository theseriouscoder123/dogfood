"use client";

import { useState } from "react";
import { CheckCircle2, CircleAlert, CircleHelp } from "lucide-react";
import { send } from "@/lib/client";
import { Button, ErrorText, inputClass } from "@/components/ui";

type Result = { found: true; receiptHash: string; status: "counted" | "quarantined"; picks: string[] } | { found: false; receiptHash: string };

export function ReceiptCheck({ slug }: { slug: string }) {
  const [receipt, setReceipt] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <div>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          // Sent in the request body, never in the URL, so receipts stay out of logs and history.
          const r = await send<Result>("POST", `/api/events/${slug}/voting/receipt`, { receipt });
          setPending(false);
          if (!r.ok) return setError(r.message);
          setError(null);
          setResult(r.data);
        }}
      >
        <input value={receipt} onChange={(e) => setReceipt(e.target.value)} placeholder="DF-XXXXX-XXXXX" required className={`${inputClass} mt-0 font-mono uppercase`} />
        <Button type="submit" disabled={pending}>
          {pending ? "Checking…" : "Check"}
        </Button>
      </form>
      {error && (
        <div className="mt-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      {result && (
        <div className="mt-4 rounded-xl border border-line bg-surface-2 p-4 text-sm">
          {!result.found ? (
            <p className="flex items-start gap-2">
              <CircleHelp className="mt-0.5 size-4 shrink-0 text-muted" /> No ballot with that receipt. Check for typos: receipts look like DF-7K3P2-Q9XMA.
            </p>
          ) : result.status === "counted" ? (
            <p className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              <span>
                <b>Counted.</b> Your picks: {result.picks.join(", ")}.
              </span>
            </p>
          ) : (
            <p className="flex items-start gap-2">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
              <span>
                <b>Set aside by the organizers</b> after an anti-abuse review, so it wasn&apos;t counted. If you think that&apos;s a mistake, contact the organizers with your
                receipt.
              </span>
            </p>
          )}
          <p className="mt-2 break-all font-mono text-[11px] text-muted">In the ballot file as {result.receiptHash}</p>
        </div>
      )}
    </div>
  );
}
