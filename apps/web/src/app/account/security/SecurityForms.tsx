"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Laptop, LogOut } from "lucide-react";
import { send } from "@/lib/client";
import { formatDate } from "@/lib/format";
import { Button, Card, Field, inputClass, Pill } from "@/components/ui";
import { useDialog, useToast } from "@/components/feedback";

type Session = { current: boolean; createdAt: string; expiresAt: string };

export function SecurityForms({ email, hasPassword, sessions }: { email: string; hasPassword: boolean; sessions: Session[] }) {
  const router = useRouter();
  const toast = useToast();
  const ask = useDialog();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [pending, setPending] = useState(false);
  const mismatch = again.length > 0 && again !== next;

  async function change(e: React.FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setPending(true);
    const r = await send("POST", "/api/me/password", { current: hasPassword ? current : undefined, next });
    setPending(false);
    if (!r.ok) return toast.error(r.message);
    toast.success(hasPassword ? "Password changed. Other devices were signed out." : "Password set.");
    setCurrent("");
    setNext("");
    setAgain("");
    router.refresh();
  }

  async function signOutOthers() {
    if (!(await ask.confirm({ title: "Sign out everywhere else?", body: "You stay signed in here.", confirmLabel: "Sign out others" }))) return;
    const r = await send<{ signedOut: number }>("POST", "/api/me/sessions/revoke-others");
    if (!r.ok) return toast.error(r.message);
    toast.success(`Signed out ${r.data.signedOut} other session${r.data.signedOut === 1 ? "" : "s"}.`);
    router.refresh();
  }

  const others = sessions.filter((s) => !s.current).length;
  return (
    <>
      <Card title={hasPassword ? "Change password" : "Set a password"} description={`Signed in as ${email}`}>
        <form onSubmit={change} className="max-w-md space-y-4">
          {hasPassword && (
            <Field label="Current password">
              <input type="password" autoComplete="current-password" className={inputClass} value={current} onChange={(e) => setCurrent(e.target.value)} required />
            </Field>
          )}
          <Field label="New password" hint="At least 8 characters">
            <input type="password" autoComplete="new-password" className={inputClass} value={next} onChange={(e) => setNext(e.target.value)} minLength={8} required />
          </Field>
          <Field label="Repeat new password" hint={mismatch ? <span className="text-danger">Doesn&apos;t match</span> : undefined}>
            <input type="password" autoComplete="new-password" className={inputClass} value={again} onChange={(e) => setAgain(e.target.value)} required />
          </Field>
          <Button type="submit" disabled={pending || mismatch || next.length < 8}>
            {pending ? "Saving…" : hasPassword ? "Change password" : "Set password"}
          </Button>
        </form>
      </Card>

      <Card
        title="Sessions"
        actions={
          others > 0 ? (
            <Button size="sm" variant="secondary" onClick={signOutOthers}>
              <LogOut className="size-3.5" /> Sign out others
            </Button>
          ) : undefined
        }
        padded={false}
      >
        <ul className="divide-y divide-line border-t border-line">
          {sessions.map((s, i) => (
            <li key={i} className="flex items-center gap-3 px-5 py-3 text-sm sm:px-6">
              <Laptop className="size-4 text-muted" />
              <span className="flex-1">Signed in {formatDate(s.createdAt)}</span>
              {s.current ? <Pill tone="success">this device</Pill> : <span className="text-xs text-muted">expires {formatDate(s.expiresAt)}</span>}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
