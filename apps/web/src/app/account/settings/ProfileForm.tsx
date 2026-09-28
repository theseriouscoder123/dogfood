"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { send } from "@/lib/client";
import type { MyProfile } from "@/lib/types";
import { Button, Card, Field, inputClass } from "@/components/ui";
import { ImageUpload } from "@/components/ImageUpload";
import { useToast } from "@/components/feedback";

export function ProfileForm({ profile }: { profile: MyProfile }) {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState({
    name: profile.name,
    handle: profile.handle,
    headline: profile.headline,
    bio: profile.bio,
    avatarUrl: profile.avatarUrl,
    location: profile.location,
    website: profile.website ?? "",
    githubUrl: profile.githubUrl ?? "",
    linkedinUrl: profile.linkedinUrl ?? "",
    skills: profile.skills,
  });
  const [skill, setSkill] = useState("");
  const [pending, setPending] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  function addSkill() {
    const s = skill.trim();
    if (s && !f.skills.includes(s) && f.skills.length < 20) set("skills", [...f.skills, s]);
    setSkill("");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const r = await send("PATCH", "/api/me/profile", f);
    setPending(false);
    if (!r.ok) return toast.error(r.message);
    toast.success("Profile saved");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <Card title="Public profile">
        <div className="grid gap-6 sm:grid-cols-[160px_minmax(0,1fr)]">
          <div>
            <span className="text-[13px] font-semibold">Photo</span>
            <div className="mt-1.5 w-40">
              <ImageUpload value={f.avatarUrl} onChange={(v) => set("avatarUrl", v)} aspect="aspect-square" label="Upload" hint="Square works best" />
            </div>
          </div>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required>
                <input className={inputClass} value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={100} required />
              </Field>
              <Field label="Handle" hint={`dogfood/u/${f.handle || "you"}`}>
                <input className={`${inputClass} font-mono`} value={f.handle} onChange={(e) => set("handle", e.target.value.toLowerCase())} maxLength={30} />
              </Field>
            </div>
            <Field label="Headline">
              <input className={inputClass} value={f.headline} onChange={(e) => set("headline", e.target.value)} maxLength={120} placeholder="Full-stack developer, climate-tech nerd" />
            </Field>
            <Field label="Location">
              <input className={inputClass} value={f.location} onChange={(e) => set("location", e.target.value)} maxLength={80} placeholder="Pune, India" />
            </Field>
          </div>
        </div>
        <div className="mt-4">
          <Field label="About">
            <textarea className={inputClass} rows={5} value={f.bio} onChange={(e) => set("bio", e.target.value)} maxLength={2000} />
          </Field>
        </div>
      </Card>

      <Card title="Skills">
        <div className="flex flex-wrap gap-2">
          {f.skills.map((s) => (
            <span key={s} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 py-1 pl-3 pr-1.5 text-sm font-semibold">
              {s}
              <button type="button" aria-label={`Remove ${s}`} onClick={() => set("skills", f.skills.filter((x) => x !== s))} className="rounded-full p-0.5 text-muted hover:bg-surface-3 hover:text-ink">
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            className={`${inputClass} mt-0 max-w-xs`}
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addSkill();
              }
            }}
            placeholder="TypeScript, Rust, Figma…"
            maxLength={30}
          />
          <Button type="button" variant="secondary" onClick={addSkill} disabled={!skill.trim()}>
            Add
          </Button>
        </div>
      </Card>

      <Card title="Links">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="GitHub">
            <input className={inputClass} value={f.githubUrl} onChange={(e) => set("githubUrl", e.target.value)} placeholder="https://github.com/you" />
          </Field>
          <Field label="LinkedIn">
            <input className={inputClass} value={f.linkedinUrl} onChange={(e) => set("linkedinUrl", e.target.value)} placeholder="https://linkedin.com/in/you" />
          </Field>
          <Field label="Website">
            <input className={inputClass} value={f.website} onChange={(e) => set("website", e.target.value)} placeholder="https://you.dev" />
          </Field>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
