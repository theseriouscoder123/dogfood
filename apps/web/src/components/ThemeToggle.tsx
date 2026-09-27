"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Choice = "light" | "dark" | "system";
const KEY = "dogfood-theme";

function apply(choice: Choice) {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

/** Cycles system → light → dark. "system" follows the OS live. */
export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>("system");

  useEffect(() => {
    let saved: Choice = "system";
    try {
      saved = (localStorage.getItem(KEY) as Choice | null) ?? "system";
    } catch {}
    setChoice(saved);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      let current: Choice = "system";
      try {
        current = (localStorage.getItem(KEY) as Choice | null) ?? "system";
      } catch {}
      if (current === "system") apply("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const next: Record<Choice, Choice> = { system: "light", light: "dark", dark: "system" };
  const Icon = choice === "light" ? Sun : choice === "dark" ? Moon : Monitor;
  return (
    <button
      type="button"
      title={`Theme: ${choice}`}
      aria-label={`Theme: ${choice}. Switch to ${next[choice]}.`}
      className="grid size-9 place-items-center rounded-[10px] text-ink-2 transition hover:bg-surface-2 hover:text-ink"
      onClick={() => {
        const n = next[choice];
        setChoice(n);
        try {
          localStorage.setItem(KEY, n);
        } catch {}
        apply(n);
      }}
    >
      <Icon className="size-[18px]" />
    </button>
  );
}

/** Runs before first paint (inlined in <head>) so there is no light flash in dark mode. */
export const themeBootScript = `(function(){try{var c=localStorage.getItem('${KEY}')||'system';var d=c==='dark'||(c==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}})()`;
