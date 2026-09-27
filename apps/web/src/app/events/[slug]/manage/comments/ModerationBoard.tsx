"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EyeOff, Flag, MessageSquare, RotateCcw, ShieldCheck } from "lucide-react";
import { send } from "@/lib/client";
import type { CommentsMode, ModerationItem, ModerationQueue } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { Button, Chip, EmptyState, ErrorText, inputClass, Pill } from "@/components/ui";
import { Avatar } from "@/components/visuals";

const MODES: Array<{ mode: CommentsMode; label: string; help: string }> = [
  { mode: "open", label: "Open", help: "Anyone signed in can comment" },
  { mode: "read_only", label: "Read-only", help: "Visible, but closed to new comments" },
  { mode: "off", label: "Off", help: "Hidden everywhere" },
];
const REASON_LABEL = { spam: "Spam", abuse: "Abuse", off_topic: "Off topic", other: "Other" } as const;

export function ModerationBoard({ slug, data, filter }: { slug: string; data: ModerationQueue; filter: "reported" | "hidden" | "recent" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const base = `/api/events/${slug}`;

  async function act(method: string, path: string, body?: unknown) {
    const r = await send(method, `${base}${path}`, body);
    if (!r.ok) {
      setError(r.message);
      return false;
    }
    setError(null);
    router.refresh();
    return true;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
        <MessageSquare className="size-5 text-muted" />
        <span className="text-sm font-semibold">Comments are</span>
        <div className="inline-flex rounded-xl border border-line bg-surface-2 p-1">
          {MODES.map((m) => (
            <button
              key={m.mode}
              title={m.help}
              onClick={() => act("PUT", "/comments/settings", { mode: m.mode })}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${data.mode === m.mode ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted">{MODES.find((m) => m.mode === data.mode)?.help}</span>
        <span className="ml-auto text-xs text-muted">{data.counts.total} comments in total</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Chip href={`?filter=reported`} active={filter === "reported"}>
          <Flag className="size-3.5" /> Reported ({data.counts.reported})
        </Chip>
        <Chip href={`?filter=hidden`} active={filter === "hidden"}>
          <EyeOff className="size-3.5" /> Hidden ({data.counts.hidden})
        </Chip>
        <Chip href={`?filter=recent`} active={filter === "recent"}>
          Recent
        </Chip>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {data.items.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="size-5" />} title={filter === "reported" ? "Nothing reported" : filter === "hidden" ? "Nothing hidden" : "No comments yet"}>
          {filter === "reported" ? "When someone reports a comment, it shows up here." : undefined}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {data.items.map((c) => (
            <Item key={c.id} slug={slug} c={c} act={act} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Item({ slug, c, act }: { slug: string; c: ModerationItem; act: (m: string, p: string, b?: unknown) => Promise<boolean> }) {
  const [hiding, setHiding] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <li className={`rounded-2xl border bg-surface p-5 shadow-card ${c.openReports.length ? "border-warn/40" : "border-line"}`}>
      <div className="flex flex-wrap items-start gap-3">
        <Avatar name={c.author.name} size={34} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="font-semibold">{c.author.name}</span>
            <span className="text-xs text-muted">
              {c.author.email} · account {c.author.accountAgeDays === 0 ? "made today" : `${c.author.accountAgeDays} days old`}
            </span>
            {c.deleted && <Pill>deleted by author</Pill>}
            {c.hidden && <Pill tone="danger">{c.hidden.auto ? "hidden automatically" : "hidden"}</Pill>}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {c.isReply ? "Reply" : "Comment"} on{" "}
            <Link href={`/events/${slug}/projects/${c.project.id}`} className="font-semibold text-primary hover:underline">
              {c.project.title}
            </Link>{" "}
            · {formatDate(c.createdAt)}
            {c.editedAt && " · edited"}
          </p>
          <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-surface-2 px-3 py-2 text-sm">{c.body}</p>

          {c.openReports.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs">
              {c.openReports.map((r, i) => (
                <li key={i} className="flex flex-wrap gap-x-2 text-ink-2">
                  <Flag className="mt-0.5 size-3.5 text-warn" />
                  <b>{REASON_LABEL[r.reason]}</b>
                  {r.note && <span>&ldquo;{r.note}&rdquo;</span>}
                  <span className="text-muted">
                    by {r.by}, {formatDate(r.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {c.hidden && (
            <p className="mt-2 text-xs text-muted">
              {c.hidden.reason} · {c.hidden.by ?? "automatic"}, {formatDate(c.hidden.at)}
            </p>
          )}

          {hiding && (
            <div className="mt-3 flex flex-wrap gap-2">
              <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why hide it? (shown in the audit log)" className={`${inputClass} mt-0 min-w-56 flex-1`} />
              <Button
                size="sm"
                variant="danger"
                disabled={reason.trim().length < 3}
                onClick={async () => {
                  if (await act("POST", `/comments/${c.id}/hide`, { reason: reason.trim() })) setHiding(false);
                }}
              >
                Hide comment
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setHiding(false)}>
                Cancel
              </Button>
            </div>
          )}
        </div>

        {!hiding && !c.deleted && (
          <div className="flex flex-wrap gap-1.5">
            {c.hidden ? (
              <Button size="sm" variant="secondary" onClick={() => act("POST", `/comments/${c.id}/unhide`, {})}>
                <RotateCcw className="size-4" /> Restore
              </Button>
            ) : (
              <Button size="sm" variant="danger" onClick={() => setHiding(true)}>
                <EyeOff className="size-4" /> Hide
              </Button>
            )}
            {c.openReports.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => act("POST", `/comments/${c.id}/dismiss`, {})}>
                <ShieldCheck className="size-4" /> Reports are wrong
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
