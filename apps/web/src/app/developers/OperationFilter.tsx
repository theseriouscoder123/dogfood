"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { inputClass } from "@/components/ui";

/** Filters the server-rendered operation list in place; nothing is fetched. */
export function OperationFilter() {
  const [q, setQ] = useState("");
  const [shown, setShown] = useState<number | null>(null);

  // A link to #operationId opens that operation.
  useEffect(() => {
    const open = () => {
      const el = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
      if (el instanceof HTMLDetailsElement) {
        el.open = true;
        el.scrollIntoView({ block: "start" });
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);

  useEffect(() => {
    const needle = q.trim().toLowerCase();
    let count = 0;
    for (const el of document.querySelectorAll<HTMLElement>("[data-op]")) {
      const hit = !needle || needle.split(/\s+/).every((w) => el.dataset.op!.includes(w));
      el.hidden = !hit;
      if (hit) count++;
    }
    for (const section of document.querySelectorAll<HTMLElement>("[data-tag-section]")) {
      section.hidden = !section.querySelector("[data-op]:not([hidden])");
    }
    setShown(needle ? count : null);
  }, [q]);

  return (
    <div className="sticky top-16 z-10 -mx-1 bg-bg/90 px-1 py-2 backdrop-blur">
      <label className="relative block">
        <span className="sr-only">Filter operations</span>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 mt-[3px] size-4 -translate-y-1/2 text-muted" />
        <input className={`${inputClass} pl-10`} placeholder="Filter by path, method or summary: “export”, “post ballot”, “judges”…" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {shown !== null && <p className="mt-1.5 px-1 text-xs text-muted">{shown === 0 ? "No operations match." : `${shown} operation${shown === 1 ? "" : "s"} match.`}</p>}
    </div>
  );
}
