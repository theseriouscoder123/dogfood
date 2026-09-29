import { CheckCircle2 } from "lucide-react";

/** Split-screen frame for login, sign-up and password pages. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:py-16">
      <div className="relative hidden overflow-hidden rounded-3xl bg-hero p-10 text-hero-ink lg:flex lg:flex-col lg:justify-between">
        <div className="hero-grid absolute inset-0" />
        <div className="absolute -left-24 -top-24 size-80 rounded-full bg-[#3346f0] opacity-50 blur-[90px]" />
        <div className="absolute -bottom-24 -right-16 size-72 rounded-full bg-[#ff6b35] opacity-30 blur-[90px]" />
        <div className="relative">
          <p className="text-sm font-semibold text-white/60">Verdict</p>
          <h2 className="mt-3 text-4xl font-extrabold leading-tight">
            Where builders ship,
            <br />
            and judging is fair.
          </h2>
        </div>
        <ul className="relative space-y-3 text-white/80">
          {["Form a team with one link", "Edit your submission right up to the deadline", "Judged on a weighted rubric, normalized across judges"].map((t) => (
            <li key={t} className="flex items-center gap-3">
              <CheckCircle2 className="size-5 shrink-0 text-[#8e9bff]" /> {t}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center">
        <div className="w-full max-w-md lg:mx-auto">
          <h1 className="text-3xl font-extrabold">{title}</h1>
          {subtitle && <div className="mt-2 text-muted">{subtitle}</div>}
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
