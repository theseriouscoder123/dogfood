// Shared building blocks. Everything reads colours from the design tokens in globals.css,
// so light and dark themes come for free.
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export const inputClass =
  "mt-1.5 w-full rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted/70 shadow-[inset_0_1px_0_rgb(0_0_0/0.02)] transition focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15 disabled:bg-surface-2 disabled:text-muted";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-ink hover:bg-primary-hover shadow-[0_1px_0_rgb(255_255_255/0.2)_inset,0_6px_16px_-6px_color-mix(in_srgb,var(--primary)_60%,transparent)]",
  accent: "bg-accent text-white hover:brightness-105 shadow-[0_6px_16px_-6px_color-mix(in_srgb,var(--accent)_70%,transparent)]",
  secondary: "border border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "border border-danger/30 bg-surface text-danger hover:bg-danger-soft",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-[15px] gap-2",
};

export const buttonClass = (variant: Variant = "primary", size: Size = "md", extra = "") =>
  `inline-flex items-center justify-center whitespace-nowrap rounded-[10px] font-semibold transition active:translate-y-px disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${extra}`;

export function Button({ variant = "primary", size = "md", className = "", ...props }: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button {...props} className={buttonClass(variant, size, className)} />;
}

export function ButtonLink({ variant = "primary", size = "md", className = "", ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link {...props} className={buttonClass(variant, size, className)} />;
}

export function Field({ label, hint, required, children }: { label: string; hint?: ReactNode; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[13px] font-semibold text-ink">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? (
    <p role="alert" className="rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger">
      {children}
    </p>
  ) : null;
}

export function SuccessText({ children }: { children: ReactNode }) {
  return children ? <p className="rounded-lg border border-success/25 bg-success-soft px-3 py-2 text-sm text-success">{children}</p> : null;
}

export function Card({ title, description, children, actions, className = "", padded = true }: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`rounded-2xl border border-line bg-surface shadow-card ${padded ? "p-5 sm:p-6" : ""} ${className}`}>
      {(title || actions) && (
        <div className={`flex items-start justify-between gap-3 ${padded ? "mb-5" : "px-5 pt-5 sm:px-6 sm:pt-6"}`}>
          <div>
            {title && <h2 className="text-[17px] font-bold text-ink">{title}</h2>}
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = "neutral" | "primary" | "accent" | "success" | "warn" | "danger" | "dark";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2 border-line",
  primary: "bg-primary-soft text-primary border-primary/20",
  accent: "bg-accent-soft text-accent border-accent/25",
  success: "bg-success-soft text-success border-success/25",
  warn: "bg-warn-soft text-warn border-warn/25",
  danger: "bg-danger-soft text-danger border-danger/25",
  dark: "bg-ink text-bg border-transparent",
};

export function Pill({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tones[tone]} ${className}`}>{children}</span>
  );
}

/** Kept for older call sites. */
export const Badge = Pill;

export function Chip({ children, active = false, href }: { children: ReactNode; active?: boolean; href?: string }) {
  const cls = `inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition ${
    active ? "border-ink bg-ink text-bg" : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink"
  }`;
  return href ? (
    <Link href={href} className={cls} scroll={false}>
      {children}
    </Link>
  ) : (
    <span className={cls}>{children}</span>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-surface/60 px-6 py-14 text-center">
      {icon && <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary">{icon}</div>}
      <h3 className="text-lg font-bold">{title}</h3>
      {children && <p className="mt-1 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, icon }: { label: string; value: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      {icon && <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-2">{icon}</div>}
      <div>
        <div className="font-display text-xl font-bold leading-tight text-ink">{value}</div>
        <div className="text-xs font-medium text-muted">{label}</div>
      </div>
    </div>
  );
}

export function SectionHeading({ eyebrow, title, children, action }: { eyebrow?: string; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-primary">{eyebrow}</p>}
        <h2 className="text-2xl font-bold text-ink sm:text-[28px]">{title}</h2>
        {children && <p className="mt-1.5 max-w-2xl text-[15px] text-muted">{children}</p>}
      </div>
      {action}
    </div>
  );
}

export function GithubIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
