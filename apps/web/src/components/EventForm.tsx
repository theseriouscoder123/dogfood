"use client";

// An event's schedule and team size (organizer console). All times are UTC. New events use the create wizard.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { fromLocalInput, send, toLocalInput } from "@/lib/client";
import { Button, Card, ErrorText, Field, inputClass } from "@/components/ui";

type Initial = {
  registrationOpensAt: string | null;
  submissionsOpenAt: string | null;
  submissionsCloseAt: string | null;
  judgingOpensAt: string | null;
  judgingClosesAt: string | null;
  maxTeamSize: number;
};

const DATE_FIELDS = [
  ["registrationOpensAt", "Registration opens", "Participants can sign up and form teams.", false],
  ["submissionsOpenAt", "Submissions open", "Hacking starts; drafts can be created.", true],
  ["submissionsCloseAt", "Submission deadline", "Edits lock. The server clock decides.", true],
  ["judgingOpensAt", "Judging opens", "Judges start scoring.", false],
  ["judgingClosesAt", "Judging closes", "Results can be published.", false],
] as const;

export function EventForm({ slug, initial }: { slug: string; initial: Initial }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { maxTeamSize: Number(f.get("maxTeamSize")) };
    for (const [key] of DATE_FIELDS) body[key] = fromLocalInput(String(f.get(key) ?? ""));
    setPending(true);
    setSaved(false);
    const r = await send("PATCH", `/api/events/${slug}`, body);
    setPending(false);
    if (!r.ok) return setError(r.message);
    setError(null);
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card title="Timeline" description="Times are in UTC.">
        <ol className="space-y-4">
          {DATE_FIELDS.map(([key, label, help, required], i) => (
            <li key={key} className="grid items-center gap-3 sm:grid-cols-[28px_1fr_260px]">
              <span className="hidden size-7 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary sm:grid">{i + 1}</span>
              <div>
                <div className="text-sm font-semibold">
                  {label}
                  {required && <span className="ml-0.5 text-danger">*</span>}
                </div>
                <div className="text-xs text-muted">{help}</div>
              </div>
              <input name={key} type="datetime-local" required={required} defaultValue={toLocalInput(initial[key])} className={`${inputClass} mt-0`} />
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Teams">
        <div className="max-w-xs">
          <Field label="Maximum team size" hint="Solo entries are always allowed.">
            <input name="maxTeamSize" type="number" min={1} max={50} required defaultValue={initial.maxTeamSize} className={inputClass} />
          </Field>
        </div>
      </Card>

      <ErrorText>{error}</ErrorText>
      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : "Save schedule"}
        </Button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-success">
            <Check className="size-4" /> Saved
          </span>
        )}
      </div>
    </form>
  );
}
