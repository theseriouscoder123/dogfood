"use client";

type Props = { eventTypes: Array<{ type: string; description: string }>; value: string[]; onChange: (v: string[]) => void };

/** "Everything" (an empty list, which also covers types added later) or a hand-picked set. */
export function EventTypePicker({ eventTypes, value, onChange }: Props) {
  const all = value.length === 0;
  const toggle = (t: string) => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
  const groups = [...new Set(eventTypes.map((t) => t.type.split(".")[0]!))];

  return (
    <fieldset>
      <legend className="text-[13px] font-semibold">Events to send</legend>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {[
          { on: all, label: "Everything", click: () => onChange([]) },
          { on: !all, label: "Let me choose", click: () => all && onChange(["project.submitted"]) },
        ].map((o) => (
          <button
            key={o.label}
            type="button"
            onClick={o.click}
            className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition ${o.on ? "border-ink bg-ink text-bg" : "border-line bg-surface text-ink-2 hover:border-line-strong"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {all ? (
        <p className="mt-2 text-xs text-muted">Every event type, including ones added in future versions.</p>
      ) : (
        <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {groups.map((g) => (
            <div key={g}>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted">{g.replace("_", " ")}</p>
              {eventTypes
                .filter((t) => t.type.startsWith(`${g}.`))
                .map((t) => (
                  <label key={t.type} className="flex cursor-pointer items-start gap-2 py-1 text-sm">
                    <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={value.includes(t.type)} onChange={() => toggle(t.type)} />
                    <span>
                      <code className="font-mono text-xs font-semibold">{t.type}</code>
                      <span className="block text-xs text-muted">{t.description}</span>
                    </span>
                  </label>
                ))}
            </div>
          ))}
        </div>
      )}
    </fieldset>
  );
}
