"use client";

import { useState } from "react";
import { useDialog } from "@/components/feedback";
import Link from "next/link";
import { Flag, MessageSquare, Pencil, Reply, Trash2 } from "lucide-react";
import { send } from "@/lib/client";
import { linkify } from "@/lib/linkify";
import type { CommentsResponse, CommentView } from "@/lib/types";
import { Button, ErrorText, inputClass, Pill } from "./ui";
import { Avatar } from "./visuals";

const MAX = 2000;

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso));
}

const REASONS: Record<string, string> = {
  unauthenticated: "",
  judge_cannot_comment: "Judges can join the discussion once judging has closed, so a public remark can't sway the scoring.",
  comments_read_only: "Comments are closed for this event. Existing ones stay visible.",
};

/** Plain text with clickable links. Never renders HTML: every run is a text node or an <a>. */
function Body({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
      {linkify(text).map((part, i) =>
        part.href ? (
          <a key={i} href={part.href} target="_blank" rel="nofollow ugc noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  );
}

function Composer({ onSubmit, placeholder, initial = "", submitLabel, onCancel, autoFocus }: {
  onSubmit: (body: string) => Promise<boolean>;
  placeholder: string;
  initial?: string;
  submitLabel: string;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [body, setBody] = useState(initial);
  const [pending, setPending] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const ok = await onSubmit(body.trim());
        setPending(false);
        if (ok && !initial) setBody("");
      }}
    >
      <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={MAX} rows={3} placeholder={placeholder} autoFocus={autoFocus} className={`${inputClass} resize-y`} />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={`text-xs tabular-nums ${body.length > MAX - 100 ? "text-warn" : "text-muted"}`}>
          {body.length}/{MAX}
        </span>
        <div className="flex gap-2">
          {onCancel && (
            <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" size="sm" disabled={pending || !body.trim()}>
            {pending ? "Posting…" : submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function CommentThread({ slug, projectId, initial }: { slug: string; projectId: string; initial: CommentsResponse }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/events/${slug}/projects/${projectId}/comments`;

  async function reload() {
    const r = await send<CommentsResponse>("GET", url);
    if (r.ok) setData(r.data);
  }
  async function act(method: string, path: string, body?: unknown) {
    const r = await send(method, `${url}${path}`, body);
    if (!r.ok) {
      setError(r.message);
      return false;
    }
    setError(null);
    await reload();
    return true;
  }

  if (data.mode === "off") return null;

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6" aria-labelledby="discussion">
      <h2 id="discussion" className="flex items-center gap-2 text-[17px] font-bold">
        <MessageSquare className="size-5 text-muted" /> Discussion <span className="text-sm font-semibold text-muted">{data.count}</span>
      </h2>

      <div className="mt-4">
        {data.canComment ? (
          <Composer placeholder="Ask the team a question or say what you liked. Be kind and specific." submitLabel="Post comment" onSubmit={(b) => act("POST", "", { body: b })} />
        ) : data.reason === "unauthenticated" ? (
          <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">
            <Link href={`/login?next=/events/${slug}/projects/${projectId}`} className="font-semibold text-primary hover:underline">
              Log in
            </Link>{" "}
            to join the discussion.
          </p>
        ) : (
          data.reason && <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">{REASONS[data.reason] ?? "You can't comment here right now."}</p>
        )}
        {error && (
          <div className="mt-3">
            <ErrorText>{error}</ErrorText>
          </div>
        )}
      </div>

      {data.threads.length === 0 ? (
        <p className="mt-6 text-center text-sm text-muted">No comments yet.{data.canComment && " Start the conversation."}</p>
      ) : (
        <ul className="mt-6 space-y-5">
          {data.threads.map((t) => (
            <li key={t.id}>
              <CommentItem c={t} canReply={data.canComment && t.state === "visible"} act={act} />
              {t.replies.length > 0 && (
                <ul className="ml-5 mt-3 space-y-3 border-l-2 border-line pl-4 sm:ml-12">
                  {t.replies.map((r) => (
                    <li key={r.id}>
                      <CommentItem c={r} canReply={false} act={act} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CommentItem({ c, canReply, act }: { c: CommentView & { replies?: CommentView[] }; canReply: boolean; act: (m: string, p: string, b?: unknown) => Promise<boolean> }) {
  const ask = useDialog();
  const [mode, setMode] = useState<"reply" | "edit" | "report" | null>(null);
  const [reason, setReason] = useState("spam");
  const [note, setNote] = useState("");

  if (c.state !== "visible")
    return <p className="rounded-xl bg-surface-2 px-4 py-2.5 text-sm italic text-muted">{c.state === "hidden" ? "This comment was removed by the organizers." : "This comment was deleted by its author."}</p>;

  return (
    <div className="flex gap-3">
      <Avatar name={c.author!.name} size={34} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-semibold">{c.author!.name}</span>
          {c.author!.badges.includes("team") && <Pill tone="primary">Team</Pill>}
          {c.author!.badges.includes("organizer") && <Pill tone="dark">Organizer</Pill>}
          <span className="text-xs text-muted" title={new Date(c.createdAt).toUTCString()}>
            {ago(c.createdAt)}
            {c.editedAt && " · edited"}
          </span>
        </div>

        {mode === "edit" ? (
          <div className="mt-2">
            <Composer
              initial={c.body!}
              autoFocus
              placeholder=""
              submitLabel="Save"
              onCancel={() => setMode(null)}
              onSubmit={async (b) => {
                const ok = await act("PATCH", `/${c.id}`, { body: b });
                if (ok) setMode(null);
                return ok;
              }}
            />
          </div>
        ) : (
          <div className="mt-1">
            <Body text={c.body!} />
          </div>
        )}

        {mode !== "edit" && (
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs font-semibold text-muted">
            {canReply && (
              <button onClick={() => setMode(mode === "reply" ? null : "reply")} className="inline-flex items-center gap-1 hover:text-ink">
                <Reply className="size-3.5" /> Reply
              </button>
            )}
            {c.canEdit && (
              <button onClick={() => setMode("edit")} className="inline-flex items-center gap-1 hover:text-ink">
                <Pencil className="size-3.5" /> Edit
              </button>
            )}
            {c.canDelete && (
              <button
                onClick={async () => {
                  if (await ask.confirm({ title: "Delete this comment?", confirmLabel: "Delete", danger: true })) void act("DELETE", `/${c.id}`);
                }}
                className="inline-flex items-center gap-1 hover:text-danger"
              >
                <Trash2 className="size-3.5" /> Delete
              </button>
            )}
            {c.canReport && (
              <button onClick={() => setMode(mode === "report" ? null : "report")} className="inline-flex items-center gap-1 hover:text-ink">
                <Flag className="size-3.5" /> Report
              </button>
            )}
            {c.reportedByMe && <span className="inline-flex items-center gap-1 text-warn"><Flag className="size-3.5" /> Reported</span>}
          </div>
        )}

        {mode === "reply" && (
          <div className="mt-3">
            <Composer
              autoFocus
              placeholder={`Reply to ${c.author!.name}`}
              submitLabel="Reply"
              onCancel={() => setMode(null)}
              onSubmit={async (b) => {
                const ok = await act("POST", "", { body: b, parentId: c.id });
                if (ok) setMode(null);
                return ok;
              }}
            />
          </div>
        )}

        {mode === "report" && (
          <form
            className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface-2 p-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act("POST", `/${c.id}/report`, { reason, note })) setMode(null);
            }}
          >
            <label className="text-xs font-semibold">
              Why?
              <select value={reason} onChange={(e) => setReason(e.target.value)} className={`${inputClass} mt-1 h-9 py-1`}>
                <option value="spam">Spam or vote-begging</option>
                <option value="abuse">Harassment or abuse</option>
                <option value="off_topic">Off topic</option>
                <option value="other">Something else</option>
              </select>
            </label>
            <label className="min-w-40 flex-1 text-xs font-semibold">
              Details (optional)
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={`${inputClass} mt-1 h-9 py-1`} />
            </label>
            <Button size="sm" type="submit">
              Send report
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setMode(null)}>
              Cancel
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
