"use client";

import { useEffect, useState } from "react";
import { useDialog } from "@/components/feedback";
import { Check, Copy, Eye, KeyRound, PencilLine, ShieldAlert, Trash2 } from "lucide-react";
import { send } from "@/lib/client";
import type { ApiToken, ApiTokenList } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { Button, Card, EmptyState, ErrorText, Field, inputClass, Pill } from "@/components/ui";

const LIFETIMES: Array<{ days: number | null; label: string }> = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
  { days: null, label: "No expiry" },
];

const STATE_TONE = { active: "success", expired: "neutral", revoked: "danger" } as const;

export function TokenManager({ initial, email }: { initial: ApiTokenList; email: string }) {
  const ask = useDialog();
  const [tokens, setTokens] = useState(initial.tokens);
  const [name, setName] = useState("");
  const [write, setWrite] = useState(false);
  const [days, setDays] = useState<number | null>(90);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<{ token: ApiToken; secret: string } | null>(null);
  const active = tokens.filter((t) => t.state === "active").length;

  async function reload() {
    const r = await send<ApiTokenList>("GET", "/api/auth/tokens");
    if (r.ok) setTokens(r.data.tokens);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await send<{ token: ApiToken; secret: string }>("POST", "/api/auth/tokens", { name, scopes: write ? ["read", "write"] : ["read"], expiresInDays: days });
    setPending(false);
    if (!r.ok) return setError(r.message);
    setCreated(r.data);
    setName("");
    await reload();
  }

  async function revoke(t: ApiToken) {
    if (!(await ask.confirm({ title: `Revoke “${t.name}”?`, body: "Anything using it stops working immediately.", confirmLabel: "Revoke", danger: true }))) return;
    const r = await send("DELETE", `/api/auth/tokens/${t.id}`);
    if (!r.ok) return setError(r.message);
    if (created?.token.id === t.id) setCreated(null);
    await reload();
  }

  return (
    <>
      {created && <NewToken secret={created.secret} name={created.token.name} onDone={() => setCreated(null)} />}

      <Card title="Create a token" description={`Signed in as ${email}`}>
        <form onSubmit={create} className="space-y-5">
          <Field label="Name" hint="So you know what to revoke later, e.g. “Results export (CI)”." required>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required placeholder="Results export (CI)" />
          </Field>
          <fieldset>
            <legend className="text-[13px] font-semibold">Scope</legend>
            <div className="mt-1.5 grid gap-3 sm:grid-cols-2">
              {[
                { value: false, icon: Eye, title: "Read only", body: "GET requests: lists, results, CSV exports. Can't change anything. Start here." },
                { value: true, icon: PencilLine, title: "Read and write", body: "Also create, edit and delete, anywhere your account can. Treat it like your password." },
              ].map((o) => (
                <label
                  key={o.title}
                  className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition ${write === o.value ? "border-primary bg-primary-soft/60 ring-4 ring-primary/10" : "border-line hover:border-line-strong"}`}
                >
                  <input type="radio" name="scope" className="sr-only" checked={write === o.value} onChange={() => setWrite(o.value)} />
                  <o.icon className={`mt-0.5 size-5 shrink-0 ${write === o.value ? "text-primary" : "text-muted"}`} />
                  <span>
                    <span className="block text-sm font-bold">{o.title}</span>
                    <span className="mt-0.5 block text-xs text-muted">{o.body}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Expires after" hint="Shorter is safer. You can always make a new one.">
            <select className={`${inputClass} block sm:max-w-xs`} value={days ?? "never"} onChange={(e) => setDays(e.target.value === "never" ? null : Number(e.target.value))}>
              {LIFETIMES.map((l) => (
                <option key={l.label} value={l.days ?? "never"}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
          <ErrorText>{error}</ErrorText>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending || !name.trim() || active >= initial.limits.maxActive}>
              <KeyRound className="size-4" /> {pending ? "Creating…" : "Create token"}
            </Button>
            <span className="text-xs text-muted">
              {active} of {initial.limits.maxActive} active tokens
            </span>
          </div>
        </form>
      </Card>

      <Card title="Your tokens" description="Revoked and expired tokens stay listed for 30 days." padded={false}>
        {tokens.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState icon={<KeyRound className="size-5" />} title="No tokens yet">
              Create one above to call the API from a script.
            </EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {tokens.map((t) => (
              <li key={t.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 sm:px-6 ${t.state === "active" ? "" : "opacity-70"}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold">{t.name}</span>
                    <Pill tone={STATE_TONE[t.state]}>{t.state}</Pill>
                    {t.scopes.includes("write") ? <Pill tone="warn">read · write</Pill> : <Pill>read only</Pill>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
                    <code className="font-mono">{t.prefix}…</code>
                    <span>created {formatDate(t.createdAt)}</span>
                    <span>{t.lastUsedAt ? `last used ${formatDate(t.lastUsedAt)}${t.lastUsedIp ? ` from ${t.lastUsedIp}` : ""}` : "never used"}</span>
                    <span>{t.revokedAt ? `revoked ${formatDate(t.revokedAt)}` : t.expiresAt ? `expires ${formatDate(t.expiresAt)}` : "never expires"}</span>
                  </div>
                </div>
                {t.state === "active" && (
                  <Button variant="danger" size="sm" onClick={() => revoke(t)}>
                    <Trash2 className="size-3.5" /> Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

    </>
  );
}

function NewToken({ secret, name, onDone }: { secret: string; name: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("http://localhost:8080");
  useEffect(() => setOrigin(window.location.origin), []);

  async function copy() {
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section role="status" className="rounded-2xl border border-success/30 bg-success-soft p-5 shadow-card sm:p-6">
      <h2 className="flex items-center gap-2 text-[17px] font-bold text-success">
        <Check className="size-5" /> “{name}” is ready. Copy it now.
      </h2>
      <p className="mt-1 text-sm text-ink-2">This is the only time the token is shown. Verdict stores a hash of it, not the token itself.</p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <code className="min-w-0 flex-1 break-all rounded-lg border border-line bg-surface px-3 py-2.5 font-mono text-sm">{secret}</code>
        <Button variant="secondary" onClick={copy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="mt-4 text-xs font-semibold text-ink-2">Try it:</p>
      <pre className="mt-1 overflow-x-auto rounded-lg bg-ink px-3 py-2.5 font-mono text-xs text-bg">{`curl -H "Authorization: Bearer ${secret}" \\\n  ${origin}/api/auth/me`}</pre>
      <Button variant="ghost" size="sm" className="mt-3" onClick={onDone}>
        I&apos;ve saved it
      </Button>
    </section>
  );
}
