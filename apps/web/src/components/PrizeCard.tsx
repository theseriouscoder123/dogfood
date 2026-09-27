import { Award, Medal, Trophy } from "lucide-react";
import type { Prize } from "@/lib/types";

// Gold, silver, bronze, then a neutral accent for everything after.
const MEDALS = [
  { ring: "from-[#f7d774] to-[#d9a520]", text: "text-[#8a6100] dark:text-[#f7d774]", bg: "bg-[#fff8e1] dark:bg-[#3a2f0e]" },
  { ring: "from-[#e4e7ee] to-[#9aa3b5]", text: "text-[#4b5467] dark:text-[#d7dbe6]", bg: "bg-[#f2f4f8] dark:bg-[#232838]" },
  { ring: "from-[#f0b58a] to-[#b8683a]", text: "text-[#8a4a1f] dark:text-[#f0b58a]", bg: "bg-[#fdf0e7] dark:bg-[#3a2416]" },
];

export function PrizeCard({ prize, index, trackName, compact = false }: { prize: Prize; index: number; trackName?: string; compact?: boolean }) {
  const medal = MEDALS[index];
  const Icon = index === 0 ? Trophy : index < 3 ? Medal : Award;
  return (
    <div className={`relative flex flex-col overflow-hidden rounded-2xl border border-line ${medal ? medal.bg : "bg-surface"} ${compact ? "p-4" : "p-5"}`}>
      <div className="flex items-start justify-between gap-3">
        <span className={`grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-card ${medal ? medal.ring : "from-primary to-[#9b6bff]"}`}>
          <Icon className="size-5" />
        </span>
        {trackName && <span className="rounded-md bg-surface/70 px-2 py-0.5 text-[11px] font-bold text-ink-2">{trackName}</span>}
      </div>
      <div className={`mt-4 font-display font-extrabold ${compact ? "text-xl" : "text-2xl"} ${medal ? medal.text : "text-ink"}`}>{prize.value || "Prize"}</div>
      <div className="mt-0.5 font-semibold text-ink">{prize.name}</div>
      {!compact && prize.description && <p className="mt-2 text-sm text-muted">{prize.description}</p>}
    </div>
  );
}
