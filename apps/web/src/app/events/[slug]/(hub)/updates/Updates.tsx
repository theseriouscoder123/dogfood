"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Megaphone, Pin, PinOff, Trash2 } from "lucide-react";
import { send } from "@/lib/client";
import { formatDate } from "@/lib/format";
import { Button, Card, Field, inputClass, Pill } from "@/components/ui";
import { Avatar } from "@/components/visuals";
import { Markdown } from "@/components/Markdown";
import { useDialog, useToast } from "@/components/feedback";

export type Announcement = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  edited: boolean;
  author: { name: string; profile: string; avatarUrl: string | null } | null;
};

export function Updates({ slug, announcements, staff }: { slug: string; announcements: Announcement[]; staff: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const ask = useDialog();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [notify, setNotify] = useState(true);
  const [pending, setPending] = useState(false);
  const base = `/api/events/${slug}/announcements`;

  async function post(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const r = await send("POST", base, { title, body, notify });
    setPending(false);
    if (!r.ok) return toast.error(r.message);
    toast.success(notify ? "Posted and sent to everyone" : "Posted");
    setTitle("");
    setBody("");
    router.refresh();
  }

  async function act(method: string, path: string, data?: unknown, done?: string) {
    const r = await send(method, path, data);
    if (!r.ok) return toast.error(r.message);
    if (done) toast.success(done);
    router.refresh();
  }

  return (
    <>
      {staff && (
        <Card title="Post an update">
          <form onSubmit={post} className="space-y-4">
            <Field label="Title">
              <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Demos start at 5pm in Hall B" required />
            </Field>
            <Field label="Message" hint="Markdown supported">
              <textarea className={inputClass} rows={4} value={body} onChange={(e) => setBody(e.target.value)} required />
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Notify participants and judges
              </label>
              <Button type="submit" disabled={pending || !title.trim() || !body.trim()}>
                <Megaphone className="size-4" /> {pending ? "Posting…" : "Post"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {announcements.map((a) => (
        <article key={a.id} id={a.id} className="scroll-mt-24 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
          <div className="flex items-start gap-3">
            {a.author ? (
              <Link href={`/u/${a.author.profile}`}>
                <Avatar name={a.author.name} src={a.author.avatarUrl} size={36} />
              </Link>
            ) : (
              <span className="grid size-9 place-items-center rounded-full bg-primary-soft text-primary">
                <Megaphone className="size-4" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold">{a.title}</h2>
                {a.pinned && (
                  <Pill tone="primary">
                    <Pin className="size-3" /> Pinned
                  </Pill>
                )}
              </div>
              <p className="text-xs text-muted">
                {a.author?.name ?? "Organizers"} · {formatDate(a.createdAt)}
                {a.edited && " · edited"}
              </p>
            </div>
            {staff && (
              <div className="flex shrink-0 gap-1">
                <button type="button" title={a.pinned ? "Unpin" : "Pin"} onClick={() => act("PATCH", `${base}/${a.id}`, { pinned: !a.pinned }, a.pinned ? "Unpinned" : "Pinned")} className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink">
                  {a.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                </button>
                <button
                  type="button"
                  title="Delete"
                  onClick={async () => (await ask.confirm({ title: "Delete this update?", confirmLabel: "Delete", danger: true })) && act("DELETE", `${base}/${a.id}`, undefined, "Deleted")}
                  className="rounded-lg p-2 text-muted hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            )}
          </div>
          <Markdown className="mt-4 text-[15px]">{a.body}</Markdown>
        </article>
      ))}
    </>
  );
}
